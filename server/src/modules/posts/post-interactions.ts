import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Param, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser, Public, Viewer } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ApiAuth, ApiErrors, ApiOptionalAuth } from '../../common/swagger/api-docs.decorators.js';
import { PostsQueryService } from './posts-query.service.js';

export type InteractionKind = 'POLL' | 'QUIZ' | 'SLIDER';

/**
 * Server-side reading of the interactive tag in a post's text (same grammar as the client widget):
 * `[poll:Question|A|B…]` (2–4 options), `[quiz:Question|correctIndex|A|B…]`, `[slider:Question|😐|🔥]`.
 */
export function parseInteraction(content: string | null): { kind: InteractionKind; options: number; correct: number | null } | null {
  const match = content ? /\[(poll|quiz|slider):([^\]]+)\]/i.exec(content) : null;
  if (!match) return null;
  const parts = match[2].split('|').map((p) => p.trim());
  const kind = match[1].toLowerCase();
  if (kind === 'poll') {
    const options = parts.slice(1).length;
    return parts[0] && options >= 2 && options <= 4 ? { kind: 'POLL', options, correct: null } : null;
  }
  if (kind === 'quiz') {
    const correct = Number(parts[1]);
    const options = parts.slice(2).length;
    return parts[0] && options && Number.isInteger(correct) && correct >= 0 && correct < options ? { kind: 'QUIZ', options, correct } : null;
  }
  return parts[0] ? { kind: 'SLIDER', options: 0, correct: null } : null;
}

export class InteractionSummaryDto {
  @ApiProperty({ enum: ['POLL', 'QUIZ', 'SLIDER'] }) kind: InteractionKind;
  @ApiProperty({ type: [Number], description: 'Responses per option (poll/quiz; empty for sliders)', example: [3, 1] })
  counts: number[];
  @ApiProperty({ description: 'Number of people who responded', example: 4 }) total: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Your option index (poll/quiz) or value 0–100 (slider); null if you have not responded or are signed out' })
  myResponse: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Sliders: average of all responses (0–100); null when nobody responded' })
  average: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Quizzes: how many answered correctly' })
  correctCount: number | null;
}

export class RespondInteractionDto {
  @ApiPropertyOptional({ description: 'Option index for polls/quizzes, or 0–100 for sliders', example: 1 })
  @IsInt()
  @Min(0)
  @Max(100)
  value: number;
}

@Injectable()
export class PostInteractionsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly query: PostsQueryService,
  ) {}

  /** The visible post that owns the widget (a plain repost points at its original). */
  private async target(postId: string, viewerId: string | null) {
    let post = await this.query.getVisible(postId, viewerId);
    if (post.kind === 'REPOST' && post.referenced_post_id) post = await this.query.getVisible(post.referenced_post_id, viewerId);
    const row = await sqlOne<{ content: string | null }>(this.db, `SELECT content FROM posts WHERE id = $1`, [post.id]);
    const widget = parseInteraction(row?.content ?? null);
    if (!widget) throw AppException.notFound(ErrorCode.NOT_FOUND, 'This post has no poll, quiz or slider');
    return { id: post.id, widget };
  }

  async summary(postId: string, viewerId: string | null): Promise<InteractionSummaryDto> {
    const { id, widget } = await this.target(postId, viewerId);
    return this.load(id, widget, viewerId);
  }

  /** One response per person; responding again keeps the first answer (like the UI). */
  async respond(postId: string, userId: string, value: number): Promise<InteractionSummaryDto> {
    const { id, widget } = await this.target(postId, userId);
    if (widget.kind !== 'SLIDER' && value >= widget.options)
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
        { field: 'value', message: `value must be an option index between 0 and ${widget.options - 1}` },
      ]);
    await sqlRows(
      this.db,
      `INSERT INTO post_interaction_responses (post_id, user_id, kind, value) VALUES ($1, $2, $3, $4)
       ON CONFLICT (post_id, kind, user_id) DO NOTHING`,
      [id, userId, widget.kind, value],
    );
    return this.load(id, widget, userId);
  }

  private async load(postId: string, widget: NonNullable<ReturnType<typeof parseInteraction>>, viewerId: string | null): Promise<InteractionSummaryDto> {
    const rows = await sqlRows<{ value: number; n: number; mine: boolean }>(
      this.db,
      `SELECT value, count(*)::int AS n, bool_or(user_id = $3) AS mine
         FROM post_interaction_responses WHERE post_id = $1 AND kind = $2 GROUP BY value`,
      [postId, widget.kind, viewerId],
    );
    const total = rows.reduce((s, r) => s + r.n, 0);
    const myResponse = rows.find((r) => r.mine)?.value ?? null;
    if (widget.kind === 'SLIDER') {
      const sum = rows.reduce((s, r) => s + r.value * r.n, 0);
      return { kind: 'SLIDER', counts: [], total, myResponse, average: total ? Math.round(sum / total) : null, correctCount: null };
    }
    // Options removed by a later edit no longer count.
    const counts = Array.from({ length: widget.options }, (_, i) => rows.find((r) => r.value === i)?.n ?? 0);
    return {
      kind: widget.kind,
      counts,
      total: counts.reduce((s, n) => s + n, 0),
      myResponse: myResponse !== null && myResponse < widget.options ? myResponse : null,
      average: null,
      correctCount: widget.kind === 'QUIZ' ? counts[widget.correct!] : null,
    };
  }
}

@ApiTags('Posts')
@Controller('posts/:id/interaction')
export class PostInteractionsController {
  constructor(private readonly interactions: PostInteractionsService) {}

  @Public()
  @Get()
  @ApiOptionalAuth()
  @ApiOperation({ summary: 'Real results of a post’s poll, quiz or slider', description: '404 when the post has no interactive widget.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: InteractionSummaryDto })
  @ApiErrors(400, 404)
  get(@Viewer() viewer: AuthUser | null, @Param('id', UuidPipe) id: string): Promise<InteractionSummaryDto> {
    return this.interactions.summary(id, viewer?.id ?? null);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({ summary: 'Vote in a poll, answer a quiz or rate a slider (once per person)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: InteractionSummaryDto })
  @ApiErrors(400, 404)
  respond(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() dto: RespondInteractionDto): Promise<InteractionSummaryDto> {
    return this.interactions.respond(id, user.id, dto.value);
  }
}
