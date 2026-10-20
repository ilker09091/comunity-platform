import { Controller, Get, Injectable, Logger, Module, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';

export class GifDto {
  @ApiProperty({ description: 'Provider id (GIPHY)' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ description: 'Animated image (WebP or GIF) for display' }) url: string;
  @ApiProperty({ type: String, nullable: true, description: 'Looping MP4, lighter than the image when supported' }) mp4: string | null;
  @ApiProperty({ description: 'Small animated preview for the picker and reply quotes' }) previewUrl: string;
  @ApiProperty() width: number;
  @ApiProperty() height: number;
}
export class GifPageDto {
  @ApiProperty({ description: 'False when no GIF provider key is configured on the server' }) enabled: boolean;
  @ApiProperty({ type: [GifDto] }) items: GifDto[];
  @ApiProperty({ type: Number, nullable: true }) nextOffset: number | null;
}
export class GifQueryDto {
  @ApiPropertyOptional({ maxLength: 50, description: 'Search words; omit for trending GIFs' })
  @IsOptional() @IsString() @MaxLength(50) q?: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 4950, default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(4950) offset?: number;
}

/** GIF ids are short alphanumeric strings at GIPHY. */
export const GIF_ID = /^[A-Za-z0-9]{4,64}$/;
const PAGE = 24;
const ALLOWED_HOSTS = /^https:\/\/(media\d*|i)\.giphy\.com\//;

interface GiphyImage { url?: string; webp?: string; mp4?: string; width?: string; height?: string }
interface GiphyGif { id: string; title?: string; images?: Record<string, GiphyImage> }

/**
 * Server-side GIPHY access: the key never reaches browsers, results are rated (default pg-13),
 * and a sent GIF is resolved by id here, so a message or comment can only ever embed GIPHY media.
 */
@Injectable()
export class GifsService {
  private readonly logger = new Logger(GifsService.name);
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private get key() { return process.env.GIPHY_API_KEY?.trim() || ''; }
  private get base() { return (process.env.GIPHY_API_URL ?? 'https://api.giphy.com/v1').replace(/\/$/, ''); }
  get enabled() { return !!this.key; }

  private async call<T>(path: string, params: Record<string, string>, ttlMs: number): Promise<T> {
    const query = new URLSearchParams({ ...params, api_key: this.key, rating: process.env.GIPHY_RATING || 'pg-13' });
    const cacheKey = `${path}?${query}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}?${query}`, { signal: AbortSignal.timeout(6000) });
    } catch (error) {
      this.logger.warn({ message: 'GIF provider unreachable', error: (error as Error).message });
      throw AppException.unprocessable(ErrorCode.FEATURE_DISABLED, 'GIFs are unavailable right now. Try again later.');
    }
    if (response.status === 404) throw AppException.notFound(ErrorCode.NOT_FOUND, 'GIF not found');
    if (!response.ok) {
      this.logger.warn({ message: 'GIF provider error', status: response.status });
      throw AppException.unprocessable(ErrorCode.FEATURE_DISABLED, 'GIFs are unavailable right now. Try again later.');
    }
    const value = (await response.json()) as T;
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  private toDto(gif: GiphyGif): GifDto | null {
    const show = gif.images?.fixed_width ?? gif.images?.downsized ?? gif.images?.original;
    const small = gif.images?.fixed_width_small ?? gif.images?.fixed_height_small ?? show;
    const url = show?.webp || show?.url;
    const previewUrl = small?.webp || small?.url || url;
    if (!url || !previewUrl || !ALLOWED_HOSTS.test(url) || !ALLOWED_HOSTS.test(previewUrl)) return null;
    const mp4 = show?.mp4 && ALLOWED_HOSTS.test(show.mp4) ? show.mp4 : null;
    return {
      id: gif.id, title: (gif.title ?? '').slice(0, 140) || 'GIF', url, mp4, previewUrl,
      width: Number(show?.width) || 200, height: Number(show?.height) || 200,
    };
  }

  async list(q: string | undefined, offset = 0): Promise<GifPageDto> {
    if (!this.enabled) return { enabled: false, items: [], nextOffset: null };
    const term = q?.trim();
    const data = await this.call<{ data: GiphyGif[]; pagination?: { total_count?: number; count?: number; offset?: number } }>(
      term ? '/gifs/search' : '/gifs/trending',
      { limit: String(PAGE), offset: String(offset), ...(term ? { q: term, lang: 'tr' } : {}) },
      term ? 5 * 60_000 : 15 * 60_000,
    );
    const items = data.data.map(gif => this.toDto(gif)).filter((gif): gif is GifDto => !!gif);
    const total = data.pagination?.total_count ?? 0;
    return { enabled: true, items, nextOffset: offset + PAGE < Math.min(total, 5000) && data.data.length === PAGE ? offset + PAGE : null };
  }

  /** The stored form of a GIF someone sends; only GIPHY-hosted media can come out of it. */
  async resolve(id: string): Promise<GifDto> {
    if (!this.enabled) throw AppException.unprocessable(ErrorCode.FEATURE_DISABLED, 'GIFs are not enabled on this server');
    if (!GIF_ID.test(id)) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Invalid GIF');
    const data = await this.call<{ data: GiphyGif }>(`/gifs/${id}`, {}, 60 * 60_000);
    const gif = data.data && this.toDto(data.data);
    if (!gif) throw AppException.notFound(ErrorCode.NOT_FOUND, 'GIF not found');
    return gif;
  }
}

@ApiTags('GIFs') @ApiAuth() @ApiErrors(400, 401, 422)
@Controller('gifs')
export class GifsController {
  constructor(private readonly gifs: GifsService) {}
  @Get()
  @ApiOperation({ operationId: 'gifsList', summary: 'Trending GIFs, or search results with `q` (GIPHY)' })
  @ApiOkResponse({ type: GifPageDto })
  list(@Query() q: GifQueryDto) { return this.gifs.list(q.q, q.offset ?? 0); }
}

@Module({ controllers: [GifsController], providers: [GifsService], exports: [GifsService] })
export class GifsModule {}
