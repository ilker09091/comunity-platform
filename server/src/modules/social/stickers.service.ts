import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ContentDeletionService } from '../media/content-deletion.service.js';
import { MediaService } from '../media/media.service.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { CreateStickerDto, StickerDto } from './social.dto.js';

/** Custom stickers a user may keep; older ones must be deleted to add more. */
export const MAX_OWN_STICKERS = 60;

/** Columns for `toStickerDto`, from `stickers sk LEFT JOIN media skm ON skm.id = sk.media_id`. */
export const STICKER_COLUMNS = `sk.id AS sticker_id, sk.owner_id AS sticker_owner_id, sk.emoji AS sticker_emoji,
  sk.name AS sticker_name, skm.storage_key AS sticker_key`;

export function toStickerDto(
  r: Record<string, any>,
  urls: MediaUrlService,
  viewerId: string | null,
): StickerDto {
  return {
    id: r.sticker_id,
    name: r.sticker_name,
    emoji: r.sticker_emoji ?? null,
    url: urls.url(r.sticker_key ?? null),
    isOwn: !!viewerId && r.sticker_owner_id === viewerId,
    isFavorite: !!r.is_favorite,
  };
}

@Injectable()
export class StickersService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly media: MediaService,
    private readonly urls: MediaUrlService,
    private readonly deletion: ContentDeletionService,
  ) {}

  /** The built-in pack first, then the viewer's own stickers (newest first). */
  async list(viewerId: string): Promise<StickerDto[]> {
    const rows = await sqlRows(
      this.db,
      `SELECT ${STICKER_COLUMNS}, (sf.user_id IS NOT NULL) AS is_favorite FROM stickers sk LEFT JOIN media skm ON skm.id = sk.media_id
      LEFT JOIN sticker_favorites sf ON sf.sticker_id=sk.id AND sf.user_id=$1
      WHERE (sk.deleted_at IS NULL AND (sk.owner_id IS NULL OR sk.owner_id = $1)) OR sf.user_id IS NOT NULL
      ORDER BY sk.owner_id IS NOT NULL, sk.position, sk.created_at DESC, sk.id`,
      [viewerId],
    );
    return rows.map((r) => toStickerDto(r, this.urls, viewerId));
  }

  async hydrate(ids:string[],viewerId:string) {
    if(!ids.length)return new Map<string,StickerDto>();
    const rows=await sqlRows(this.db,`SELECT ${STICKER_COLUMNS}, EXISTS(SELECT 1 FROM sticker_favorites f WHERE f.sticker_id=sk.id AND f.user_id=$2) AS is_favorite
      FROM stickers sk LEFT JOIN media skm ON skm.id=sk.media_id WHERE sk.id=ANY($1::uuid[])`,[ids,viewerId]);
    return new Map(rows.map(r=>[r.sticker_id,toStickerDto(r,this.urls,viewerId)]));
  }

  async assertAvailable(viewerId:string,id:string,m:DataSource|EntityManager=this.db) {
    const row=await sqlOne(m,`SELECT sk.id FROM stickers sk WHERE sk.id=$2 AND (
      (sk.deleted_at IS NULL AND (sk.owner_id IS NULL OR sk.owner_id=$1))
      OR EXISTS(SELECT 1 FROM sticker_favorites f WHERE f.user_id=$1 AND f.sticker_id=sk.id)
      OR EXISTS(SELECT 1 FROM direct_messages d WHERE d.recipient_id=$1 AND d.sticker_id=sk.id)) FOR SHARE`,[viewerId,id]);
    if(!row)throw AppException.notFound(ErrorCode.NOT_FOUND,'Sticker not found');
  }

  async favorite(viewerId:string,id:string) {
    await this.db.transaction(async m=>{
      await this.assertAvailable(viewerId,id,m);
      await sqlRows(m,'INSERT INTO sticker_favorites(user_id,sticker_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[viewerId,id]);
    });
  }
  async unfavorite(viewerId:string,id:string) {
    await sqlRows(this.db,'DELETE FROM sticker_favorites WHERE user_id=$1 AND sticker_id=$2',[viewerId,id]);
  }

  async create(ownerId: string, dto: CreateStickerDto): Promise<StickerDto> {
    const id = await this.db.transaction(async (m) => {
      // Serialises concurrent creates by the same user so the limit holds.
      await sqlRows(m, 'SELECT id FROM users WHERE id = $1 FOR UPDATE', [ownerId]);
      const count = await sqlOne<{ n: number }>(
        m,
        'SELECT count(*)::int AS n FROM stickers WHERE owner_id = $1 AND deleted_at IS NULL',
        [ownerId],
      );
      if ((count?.n ?? 0) >= MAX_OWN_STICKERS)
        throw AppException.conflict(
          ErrorCode.CONFLICT,
          `You can keep up to ${MAX_OWN_STICKERS} stickers. Delete one to add another.`,
        );
      const [media] = await this.media.lockAttachable(m, ownerId, [dto.mediaId]);
      if (media.type !== 'IMAGE' || media.status !== 'READY')
        throw AppException.badRequest(
          ErrorCode.INVALID_MEDIA,
          'Stickers must be made from a photo',
        );
      return (await sqlOne<{ id: string }>(
        m,
        'INSERT INTO stickers(owner_id, media_id, name) VALUES ($1, $2, $3) RETURNING id',
        [ownerId, dto.mediaId, dto.name?.trim() || 'Sticker'],
      ))!.id;
    });
    const row = await sqlOne(
      this.db,
      `SELECT ${STICKER_COLUMNS} FROM stickers sk LEFT JOIN media skm ON skm.id = sk.media_id WHERE sk.id = $1`,
      [id],
    );
    return toStickerDto(row!, this.urls, ownerId);
  }

  /**
   * Removes a sticker from its owner's tray. Comments that already use it keep showing it,
   * so it is only erased (with its image) when nothing references it.
   */
  async remove(ownerId: string, stickerId: string) {
    const files = await this.db.transaction(async (m) => {
      const sticker = await sqlOne<{ media_id: string; used: boolean }>(
        m,
        `SELECT media_id, (EXISTS (SELECT 1 FROM comments c WHERE c.sticker_id = s.id)
          OR EXISTS(SELECT 1 FROM direct_messages d WHERE d.sticker_id=s.id)
          OR EXISTS(SELECT 1 FROM sticker_favorites f WHERE f.sticker_id=s.id)) AS used
        FROM stickers s WHERE s.id = $1 AND s.owner_id = $2 AND s.deleted_at IS NULL FOR UPDATE`,
        [stickerId, ownerId],
      );
      if (!sticker) throw AppException.notFound();
      if (sticker.used) {
        await sqlRows(m, 'UPDATE stickers SET deleted_at = now() WHERE id = $1', [stickerId]);
        return null;
      }
      await sqlRows(m, 'DELETE FROM stickers WHERE id = $1', [stickerId]);
      return this.deletion.deleteMedia(m, [sticker.media_id]);
    });
    if (files) await this.deletion.removeFiles(files);
  }
}
