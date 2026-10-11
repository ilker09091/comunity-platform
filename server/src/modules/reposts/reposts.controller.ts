import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Viewer } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { CursorQueryDto, Paginated } from '../../common/dto/common.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { ApiAuth, ApiErrors, ApiOptionalAuth } from '../../common/swagger/api-docs.decorators.js';
import { CreatePostDto, PostDto } from '../posts/dto/post.dto.js';
import { UserListItemDto } from '../users/dto/user.dto.js';
import { RepostResultDto, RepostsService } from './reposts.service.js';

@ApiTags('Reposts')
@Controller('posts/:id')
export class RepostsController {
  constructor(private readonly reposts: RepostsService) {}

  @Post('repost')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({
    summary: 'Simple repost (idempotent)',
    description: 'Only PUBLIC posts of public accounts can be reposted (422 `POST_NOT_REPOSTABLE`). Reposting a repost targets its original.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RepostResultDto })
  @ApiErrors(400, 404, 422)
  repost(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<RepostResultDto> {
    return this.reposts.repost(user.id, id);
  }

  @Delete('repost')
  @ApiAuth()
  @ApiOperation({ summary: 'Undo a simple repost (idempotent)', description: 'Accepts the original post id or the repost id.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RepostResultDto })
  @ApiErrors(400, 404)
  undo(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<RepostResultDto> {
    return this.reposts.undoRepost(user.id, id);
  }

  @Post('quote')
  @ApiAuth()
  @ApiOperation({ summary: 'Quote repost: a new post with commentary embedding the original' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Post being quoted' })
  @ApiCreatedResponse({ type: PostDto })
  @ApiErrors(400, 404, 409, 422)
  quote(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() dto: CreatePostDto): Promise<PostDto> {
    return this.reposts.quote(user.id, id, dto);
  }

  @Public()
  @Get('reposts')
  @ApiOptionalAuth()
  @ApiOperation({ summary: 'Users who reposted a post' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Paginated(UserListItemDto) })
  @ApiErrors(400, 404)
  reposters(
    @Param('id', UuidPipe) id: string,
    @Viewer() viewer: AuthUser | null,
    @Query() q: CursorQueryDto,
  ): Promise<Page<UserListItemDto>> {
    return this.reposts.listReposters(id, viewer?.id ?? null, q.cursor, q.limit ?? 20);
  }

  @Public()
  @Get('quotes')
  @ApiOptionalAuth()
  @ApiOperation({ summary: 'Quote posts of a post' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Paginated(PostDto) })
  @ApiErrors(400, 404)
  quotes(@Param('id', UuidPipe) id: string, @Viewer() viewer: AuthUser | null, @Query() q: CursorQueryDto): Promise<Page<PostDto>> {
    return this.reposts.listQuotes(id, viewer?.id ?? null, q.cursor, q.limit ?? 20);
  }
}
