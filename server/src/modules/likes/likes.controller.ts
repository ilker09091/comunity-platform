import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Viewer } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { CursorQueryDto, Paginated } from '../../common/dto/common.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { ApiAuth, ApiErrors, ApiOptionalAuth } from '../../common/swagger/api-docs.decorators.js';
import { UserListItemDto } from '../users/dto/user.dto.js';
import { LikeResultDto, LikesService } from './likes.service.js';

@ApiTags('Likes')
@Controller()
export class LikesController {
  constructor(private readonly likes: LikesService) {}

  @Post('posts/:id/like')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({ summary: 'Like a post (idempotent)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LikeResultDto })
  @ApiErrors(400, 404)
  likePost(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<LikeResultDto> {
    return this.likes.likePost(user.id, id);
  }

  @Delete('posts/:id/like')
  @ApiAuth()
  @ApiOperation({ summary: 'Unlike a post (idempotent)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LikeResultDto })
  @ApiErrors(400, 404)
  unlikePost(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<LikeResultDto> {
    return this.likes.unlikePost(user.id, id);
  }

  @Public()
  @Get('posts/:id/likes')
  @ApiOptionalAuth()
  @ApiOperation({ summary: 'Users who liked a post (most recent first)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Paginated(UserListItemDto) })
  @ApiErrors(400, 404)
  likers(
    @Param('id', UuidPipe) id: string,
    @Viewer() viewer: AuthUser | null,
    @Query() q: CursorQueryDto,
  ): Promise<Page<UserListItemDto>> {
    return this.likes.listPostLikers(id, viewer?.id ?? null, q.cursor, q.limit ?? 20);
  }

  @Post('comments/:id/like')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({ summary: 'Like a comment (idempotent)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LikeResultDto })
  @ApiErrors(400, 404)
  likeComment(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<LikeResultDto> {
    return this.likes.likeComment(user.id, id);
  }

  @Delete('comments/:id/like')
  @ApiAuth()
  @ApiOperation({ summary: 'Unlike a comment (idempotent)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LikeResultDto })
  @ApiErrors(400, 404)
  unlikeComment(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<LikeResultDto> {
    return this.likes.unlikeComment(user.id, id);
  }
}
