import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Viewer } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { CursorQueryDto, Paginated } from '../../common/dto/common.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { ApiAuth, ApiErrors, ApiOptionalAuth } from '../../common/swagger/api-docs.decorators.js';
import { CommentsService } from './comments.service.js';
import { CommentDto, CommentsQueryDto, CreateCommentDto, UpdateCommentDto } from './dto/comment.dto.js';

@ApiTags('Comments')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Public()
  @Get('posts/:id/comments')
  @ApiOptionalAuth()
  @ApiOperation({ summary: 'Top-level comments of a post', description: 'Use `/comments/{id}/replies` to expand threads.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Post id' })
  @ApiOkResponse({ type: Paginated(CommentDto) })
  @ApiErrors(400, 404)
  listForPost(
    @Param('id', UuidPipe) id: string,
    @Viewer() viewer: AuthUser | null,
    @Query() q: CommentsQueryDto,
  ): Promise<Page<CommentDto>> {
    return this.comments.listForPost(id, viewer?.id ?? null, q.cursor, q.limit ?? 20, q.sort);
  }

  @Post('posts/:id/comments')
  @ApiAuth()
  @ApiOperation({ summary: 'Add a top-level comment to a post' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Post id' })
  @ApiCreatedResponse({ type: CommentDto })
  @ApiErrors(400, 404)
  create(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() dto: CreateCommentDto): Promise<CommentDto> {
    return this.comments.create(user.id, id, dto.content ?? '', null, dto.stickerId, dto.gifId);
  }

  @Public()
  @Get('comments/:id')
  @ApiOptionalAuth()
  @ApiOperation({ summary: 'Get a single comment' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommentDto })
  @ApiErrors(400, 404)
  get(@Param('id', UuidPipe) id: string, @Viewer() viewer: AuthUser | null): Promise<CommentDto> {
    return this.comments.get(id, viewer?.id ?? null);
  }

  @Patch('comments/:id')
  @ApiAuth()
  @ApiOperation({ summary: 'Edit own comment' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommentDto })
  @ApiErrors(400, 403, 404)
  update(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() dto: UpdateCommentDto): Promise<CommentDto> {
    return this.comments.update(user.id, id, dto.content);
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAuth()
  @ApiOperation({
    summary: 'Delete a comment (soft delete)',
    description: 'Allowed for the comment author and the post author. Comments with replies remain as DELETED tombstones.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrors(400, 403, 404)
  async remove(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.comments.remove(user.id, id);
  }

  @Public()
  @Get('comments/:id/replies')
  @ApiOptionalAuth()
  @ApiOperation({ summary: 'Direct replies of a comment (oldest first)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Paginated(CommentDto) })
  @ApiErrors(400, 404)
  replies(
    @Param('id', UuidPipe) id: string,
    @Viewer() viewer: AuthUser | null,
    @Query() q: CursorQueryDto,
  ): Promise<Page<CommentDto>> {
    return this.comments.listReplies(id, viewer?.id ?? null, q.cursor, q.limit ?? 20);
  }

  @Post('comments/:id/replies')
  @ApiAuth()
  @ApiOperation({ summary: 'Reply to a comment', description: '422 `MAX_DEPTH_EXCEEDED` when the thread depth limit (COMMENT_MAX_DEPTH) is reached.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Parent comment id' })
  @ApiCreatedResponse({ type: CommentDto })
  @ApiErrors(400, 404, 422)
  reply(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() dto: CreateCommentDto): Promise<CommentDto> {
    return this.comments.create(user.id, id, dto.content ?? '', id, dto.stickerId, dto.gifId);
  }
}
