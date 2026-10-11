import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { CursorQueryDto, Paginated } from '../../common/dto/common.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import { PostDto } from '../posts/dto/post.dto.js';
import { BookmarkResultDto, BookmarksService } from './bookmarks.service.js';

@ApiTags('Bookmarks')
@ApiAuth()
@Controller()
export class BookmarksController {
  constructor(private readonly bookmarks: BookmarksService) {}

  @Get('users/me/bookmarks')
  @ApiOperation({ summary: 'Your saved posts (private, most recently saved first)' })
  @ApiOkResponse({ type: Paginated(PostDto) })
  @ApiErrors(400)
  list(@CurrentUser() user: AuthUser, @Query() q: CursorQueryDto): Promise<Page<PostDto>> {
    return this.bookmarks.list(user.id, q.cursor, q.limit ?? 20);
  }

  @Post('posts/:id/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bookmark a post (idempotent)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookmarkResultDto })
  @ApiErrors(400, 404)
  add(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<BookmarkResultDto> {
    return this.bookmarks.add(user.id, id);
  }

  @Delete('posts/:id/bookmark')
  @ApiOperation({ summary: 'Remove a bookmark (idempotent)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookmarkResultDto })
  @ApiErrors(400, 404)
  remove(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<BookmarkResultDto> {
    return this.bookmarks.remove(user.id, id);
  }
}
