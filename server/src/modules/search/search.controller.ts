import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, Viewer } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { Paginated } from '../../common/dto/common.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { ApiErrors, ApiOptionalAuth } from '../../common/swagger/api-docs.decorators.js';
import { PostDto } from '../posts/dto/post.dto.js';
import { UserListItemDto } from '../users/dto/user.dto.js';
import { SearchQueryDto, SearchService } from './search.service.js';

@ApiTags('Search')
@Public()
@ApiOptionalAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('users')
  @ApiOperation({
    summary: 'Search users by username or display name',
    description: 'Fuzzy (trigram) + prefix matching, best matches first. A leading "@" is ignored.',
  })
  @ApiOkResponse({ type: Paginated(UserListItemDto) })
  @ApiErrors(400)
  users(@Query() q: SearchQueryDto, @Viewer() viewer: AuthUser | null): Promise<Page<UserListItemDto>> {
    return this.search.searchUsers(q.q, viewer?.id ?? null, q.cursor, q.limit ?? 20);
  }

  @Get('posts')
  @ApiOperation({
    summary: 'Full-text search over post content',
    description: 'Whole-word matching with web-search syntax: `"exact phrase"`, `-exclude`, `a or b`. Newest first.',
  })
  @ApiOkResponse({ type: Paginated(PostDto) })
  @ApiErrors(400)
  posts(@Query() q: SearchQueryDto, @Viewer() viewer: AuthUser | null): Promise<Page<PostDto>> {
    return this.search.searchPosts(q.q, viewer?.id ?? null, q.cursor, q.limit ?? 20);
  }
}
