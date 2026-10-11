import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UuidPipe } from '../../../common/errors/validation.js';
import { ApiErrors } from '../../../common/swagger/api-docs.decorators.js';
import { ReqContext, type RequestContext } from '../../platform/audit.service.js';
import { ContentModerationService } from '../../platform/content-moderation.service.js';
import { AdminContentService } from '../admin-content.service.js';
import { AdminDeletionService } from '../admin-deletion.service.js';
import { AdminController, ApiStepUp, RequirePermissions } from '../admin.guard.js';
import {
  AdminCommentDetailDto,
  AdminCommentRowDto,
  AdminCommentsQueryDto,
  AdminContentQueryDto,
  AdminPageOf,
  AdminPostDetailDto,
  AdminPostRowDto,
  AdminPostsQueryDto,
  AdminReelRowDto,
  ModerateContentDto,
  ModerationOutcomeDto,
  ReasonDto,
  DeletionResultDto,
  type AdminPage,
} from '../dto/admin.dto.js';

const MODERATION_NOTE =
  'HIDDEN and REMOVED are reversible and invisible to users; nothing is deleted. Posts with video require `reels.moderate`. Moderators cannot moderate their own content.';

@ApiTags('Admin · Content')
@AdminController()
@Controller('admin')
export class AdminContentController {
  constructor(
    private readonly content: AdminContentService,
    private readonly moderation: ContentModerationService,
    private readonly deletion: AdminDeletionService,
  ) {}

  @Post('posts/:id/delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('posts.read')
  @ApiStepUp()
  @ApiOperation({ summary: 'Permanently delete a post or Reel and its unused media files' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DeletionResultDto })
  @ApiErrors(400, 403, 404)
  deletePost(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: ReasonDto): Promise<DeletionResultDto> {
    return this.deletion.deletePost(ctx, id, dto.reason);
  }

  @Post('comments/:id/delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('comments.moderate')
  @ApiStepUp()
  @ApiOperation({ summary: 'Permanently erase a comment; empty reply placeholders preserve other users’ threads' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DeletionResultDto })
  @ApiErrors(400, 403, 404)
  deleteComment(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: ReasonDto): Promise<DeletionResultDto> {
    return this.deletion.deleteComment(ctx, id, dto.reason);
  }

  @Get('posts')
  @RequirePermissions('posts.read')
  @ApiOperation({ summary: 'Search and filter posts (all statuses, including deleted)' })
  @ApiOkResponse({ type: AdminPageOf(AdminPostRowDto) })
  @ApiErrors(400)
  posts(@Query() q: AdminPostsQueryDto): Promise<AdminPage<AdminPostRowDto>> {
    return this.content.listPosts(q);
  }

  @Get('posts/:id')
  @RequirePermissions('posts.read')
  @ApiOperation({ summary: 'Post detail with exact content, media, reports and moderation history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminPostDetailDto })
  @ApiErrors(400, 404)
  post(@Param('id', UuidPipe) id: string): Promise<AdminPostDetailDto> {
    return this.content.postDetail(id);
  }

  @Post('posts/:id/moderation')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('posts.read')
  @ApiOperation({ summary: 'Hide, remove or restore a post (or Reel)', description: MODERATION_NOTE })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ModerationOutcomeDto })
  @ApiErrors(400, 404)
  async moderatePost(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: ModerateContentDto): Promise<ModerationOutcomeDto> {
    return (await this.moderation.setStatus(ctx, 'post', id, dto.status, {
      reason: dto.reason,
      resolveReports: dto.resolveReports,
    })) as ModerationOutcomeDto;
  }

  @Get('reels')
  @RequirePermissions('posts.read')
  @ApiOperation({
    summary: 'Reels: posts with video',
    description: 'Width, height and duration are null when unknown (no server-side transcoder/probe).',
  })
  @ApiOkResponse({ type: AdminPageOf(AdminReelRowDto) })
  @ApiErrors(400)
  reels(@Query() q: AdminContentQueryDto): Promise<AdminPage<AdminReelRowDto>> {
    return this.content.listReels(q);
  }

  @Get('comments')
  @RequirePermissions('posts.read')
  @ApiOperation({ summary: 'Search and filter comments (exact content, all statuses)' })
  @ApiOkResponse({ type: AdminPageOf(AdminCommentRowDto) })
  @ApiErrors(400)
  comments(@Query() q: AdminCommentsQueryDto): Promise<AdminPage<AdminCommentRowDto>> {
    return this.content.listComments(q);
  }

  @Get('comments/:id')
  @RequirePermissions('posts.read')
  @ApiOperation({ summary: 'Comment with thread context, replies, parent post, reports and history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminCommentDetailDto })
  @ApiErrors(400, 404)
  comment(@Param('id', UuidPipe) id: string): Promise<AdminCommentDetailDto> {
    return this.content.commentDetail(id);
  }

  @Post('comments/:id/moderation')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('comments.moderate')
  @ApiOperation({
    summary: 'Hide, remove or restore a comment',
    description: `${MODERATION_NOTE} Removed comments with replies remain as placeholders so threads stay intact.`,
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ModerationOutcomeDto })
  @ApiErrors(400, 404)
  async moderateComment(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: ModerateContentDto): Promise<ModerationOutcomeDto> {
    return (await this.moderation.setStatus(ctx, 'comment', id, dto.status, {
      reason: dto.reason,
      resolveReports: dto.resolveReports,
    })) as ModerationOutcomeDto;
  }
}
