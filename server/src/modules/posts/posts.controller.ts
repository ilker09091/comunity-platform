import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional } from 'class-validator';
import { CurrentUser, Public, Viewer } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { Paginated } from '../../common/dto/common.dto.js';
import { ContentQueryDto } from '../../common/dto/content-query.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { ApiAuth, ApiErrors, ApiOptionalAuth } from '../../common/swagger/api-docs.decorators.js';
import { CreatePostDto, EngagementSummaryDto, PostDto, PostKindEnum, UpdatePostDto } from './dto/post.dto.js';
import { PostsQueryService } from './posts-query.service.js';
import { PostsService } from './posts.service.js';

export class UserPostsQueryDto extends ContentQueryDto {
  @ApiPropertyOptional({
    enum: PostKindEnum,
    enumName: 'PostKind',
    isArray: true,
    example: ['POST', 'QUOTE'],
    description: 'Comma-separated kinds to include (default: all)',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @IsEnum(PostKindEnum, { each: true })
  kinds?: PostKindEnum[];
}

@ApiTags('Posts')
@Controller()
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly query: PostsQueryService,
  ) {}

  @Post('posts')
  @ApiAuth()
  @ApiOperation({ summary: 'Create a post (text, images, video or mixed)' })
  @ApiCreatedResponse({ type: PostDto })
  @ApiErrors(400, 404, 409)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePostDto): Promise<PostDto> {
    return this.posts.create(user.id, dto);
  }

  @Public()
  @Get('posts/:id')
  @ApiOptionalAuth()
  @ApiOperation({ summary: 'Get a single post' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostDto })
  @ApiErrors(400, 404)
  get(@Param('id', UuidPipe) id: string, @Viewer() viewer: AuthUser | null): Promise<PostDto> {
    return this.query.getOne(id, viewer?.id ?? null);
  }

  @Patch('posts/:id')
  @ApiAuth()
  @ApiOperation({ summary: 'Edit own post', description: 'Sets `editedAt` when content or attachments change. Simple reposts cannot be edited.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostDto })
  @ApiErrors(400, 403, 404, 409, 422)
  update(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() dto: UpdatePostDto): Promise<PostDto> {
    return this.posts.update(user.id, id, dto);
  }

  @Delete('posts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAuth()
  @ApiOperation({ summary: 'Permanently delete own post and unused media files', description: 'Also used to undo a simple repost by its own id. Cannot be restored.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrors(400, 403, 404)
  async remove(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.posts.remove(user.id, id);
  }

  @Public()
  @Get('posts/:id/engagement')
  @ApiOptionalAuth()
  @ApiOperation({ summary: 'Engagement counters and viewer flags for a post' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EngagementSummaryDto })
  @ApiErrors(400, 404)
  engagement(@Param('id', UuidPipe) id: string, @Viewer() viewer: AuthUser | null): Promise<EngagementSummaryDto> {
    return this.posts.engagement(id, viewer?.id ?? null);
  }

  @Public()
  @Get('users/:id/posts')
  @ApiOptionalAuth()
  @ApiOperation({ summary: "A user's posts, quotes and reposts (newest first)" })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User id' })
  @ApiOkResponse({ type: Paginated(PostDto) })
  @ApiErrors(400, 403, 404)
  byUser(
    @Param('id', UuidPipe) id: string,
    @Viewer() viewer: AuthUser | null,
    @Query() q: UserPostsQueryDto,
  ): Promise<Page<PostDto>> {
    return this.posts.listByUser(id, viewer?.id ?? null, q.cursor, q.limit ?? 20, q.kinds, q.content ?? 'all');
  }
}
