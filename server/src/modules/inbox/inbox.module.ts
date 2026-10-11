import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Module, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { CountDto, CursorQueryDto, Paginated } from '../../common/dto/common.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { decodeCursor, iso, toPage } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import { ReportReasonEnum } from '../reports/dto/report.dto.js';

export enum InboxKindEnum {
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  WARNING = 'WARNING',
}

export class InboxItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: InboxKindEnum, enumName: 'InboxKind' }) kind: InboxKindEnum;
  @ApiProperty({ example: 'Scheduled maintenance on Sunday' }) title: string;
  @ApiProperty({ example: 'Circle will be read-only for about 30 minutes…' }) body: string;
  @ApiProperty({ enum: ReportReasonEnum, enumName: 'ReportReason', nullable: true, description: 'Policy area for warnings' })
  reason: ReportReasonEnum | null;
  @ApiProperty({ example: false }) isRead: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class InboxItemRefDto {
  @ApiProperty({ enum: InboxKindEnum, enumName: 'InboxKind' }) @IsEnum(InboxKindEnum) kind: InboxKindEnum;
  @ApiProperty({ format: 'uuid' }) @IsUUID('all') id: string;
}

export class MarkInboxReadDto {
  @ApiPropertyOptional({ type: [InboxItemRefDto], description: 'Items to mark read; omit to mark everything read' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InboxItemRefDto)
  items?: InboxItemRefDto[];
}

export class MarkInboxReadResultDto {
  @ApiProperty({ example: 2 }) updated: number;
}

const REASON_TITLES: Record<string, string> = {
  SPAM: 'Spam',
  HARASSMENT: 'Harassment or bullying',
  HATE_SPEECH: 'Hate speech',
  VIOLENCE: 'Violence or threats',
  NUDITY: 'Nudity or sexual content',
  SELF_HARM: 'Self-harm',
  MISINFORMATION: 'False information',
  IMPERSONATION: 'Impersonation',
  INTELLECTUAL_PROPERTY: 'Intellectual property',
  OTHER: 'Community guidelines',
};

/**
 * In-app inbox for platform announcements and policy warnings. Announcements to "all users"
 * are a single row; read state is stored per user, so publishing never fans out rows.
 */
@Injectable()
export class InboxService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private visibleSql = `
    SELECT a.id, 'ANNOUNCEMENT' AS kind, a.title, a.body, NULL::report_reason AS reason,
           a.published_at AS created_at, (ar.user_id IS NOT NULL) AS is_read
      FROM announcements a
      LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = $1
     WHERE a.status = 'PUBLISHED'
       AND (a.audience = 'ALL' OR EXISTS (
             SELECT 1 FROM announcement_recipients rc WHERE rc.announcement_id = a.id AND rc.user_id = $1))
    UNION ALL
    SELECT w.id, 'WARNING', NULL, w.message, w.reason, w.created_at, (w.read_at IS NOT NULL)
      FROM user_warnings w WHERE w.user_id = $1`;

  async list(userId: string, cursorStr: string | undefined, limit: number): Promise<Page<InboxItemDto>> {
    const cursor = decodeCursor(cursorStr, ['date', 'uuid']);
    const rows = await sqlRows(
      this.db,
      `SELECT * FROM (${this.visibleSql}) x
        ${cursor ? 'WHERE (x.created_at, x.id) < ($3::timestamptz, $4::uuid)' : ''}
        ORDER BY x.created_at DESC, x.id DESC LIMIT $2`,
      cursor ? [userId, limit + 1, ...cursor] : [userId, limit + 1],
    );
    return toPage(
      rows,
      limit,
      (r) => ({
        id: r.id,
        kind: r.kind,
        title: r.kind === 'WARNING' ? `Warning: ${REASON_TITLES[r.reason] ?? 'Community guidelines'}` : r.title,
        body: r.body,
        reason: r.reason,
        isRead: r.is_read,
        createdAt: iso(r.created_at)!,
      }),
      (r) => [iso(r.created_at)!, r.id],
    );
  }

  async unreadCount(userId: string): Promise<number> {
    const row = await sqlOne<{ n: number }>(
      this.db,
      `SELECT count(*)::int AS n FROM (${this.visibleSql}) x WHERE NOT x.is_read`,
      [userId],
    );
    return row?.n ?? 0;
  }

  async markRead(userId: string, items?: InboxItemRefDto[]): Promise<number> {
    return this.db.transaction(async (m) => {
      const announcementIds = items?.filter((i) => i.kind === 'ANNOUNCEMENT').map((i) => i.id);
      const warningIds = items?.filter((i) => i.kind === 'WARNING').map((i) => i.id);
      const a = await sqlRows(
        m,
        `INSERT INTO announcement_reads (announcement_id, user_id)
         SELECT a.id, $1 FROM announcements a
          WHERE a.status = 'PUBLISHED' AND ($2::uuid[] IS NULL OR a.id = ANY($2::uuid[]))
            AND (a.audience = 'ALL' OR EXISTS (
                  SELECT 1 FROM announcement_recipients rc WHERE rc.announcement_id = a.id AND rc.user_id = $1))
         ON CONFLICT DO NOTHING RETURNING announcement_id`,
        [userId, items ? announcementIds : null],
      );
      const w = await sqlRows(
        m,
        `UPDATE user_warnings SET read_at = now()
          WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) RETURNING id`,
        [userId, items ? warningIds : null],
      );
      return a.length + w.length;
    });
  }
}

@ApiTags('Inbox')
@ApiAuth()
@Controller('users/me/inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @ApiOperation({
    summary: 'Announcements and account messages (policy warnings), newest first',
    description: 'In-app only: email delivery is not configured. Reading the inbox does not mark items read.',
  })
  @ApiOkResponse({ type: Paginated(InboxItemDto) })
  @ApiErrors(400)
  list(@CurrentUser() user: AuthUser, @Query() q: CursorQueryDto): Promise<Page<InboxItemDto>> {
    return this.inbox.list(user.id, q.cursor, q.limit ?? 20);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread announcements and warnings' })
  @ApiOkResponse({ type: CountDto })
  async unread(@CurrentUser() user: AuthUser): Promise<CountDto> {
    return { count: await this.inbox.unreadCount(user.id) };
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark inbox items read (all when `items` is omitted)' })
  @ApiOkResponse({ type: MarkInboxReadResultDto })
  @ApiErrors(400)
  async read(@CurrentUser() user: AuthUser, @Body() dto: MarkInboxReadDto): Promise<MarkInboxReadResultDto> {
    return { updated: await this.inbox.markRead(user.id, dto.items) };
  }
}

@Module({ controllers: [InboxController], providers: [InboxService] })
export class InboxModule {}
