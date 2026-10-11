import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Viewer } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { CursorQueryDto, Paginated } from '../../common/dto/common.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { ApiAuth, ApiErrors, ApiOptionalAuth } from '../../common/swagger/api-docs.decorators.js';
import { UserListItemDto } from '../users/dto/user.dto.js';
import {
  BlockedUserDto,
  BlockResultDto,
  FollowRequestDto,
  FollowResultDto,
  SuggestedUsersDto,
  SuggestionsQueryDto,
} from './dto/follow.dto.js';
import { FollowsService } from './follows.service.js';

@ApiTags('Follows')
@Controller('users')
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  // ---- Own follow requests (static `me` routes first) ----

  @Get('me/follow-requests')
  @ApiAuth()
  @ApiOperation({ summary: 'Incoming pending follow requests' })
  @ApiOkResponse({ type: Paginated(FollowRequestDto) })
  @ApiErrors(400)
  listRequests(@CurrentUser() user: AuthUser, @Query() q: CursorQueryDto): Promise<Page<FollowRequestDto>> {
    return this.follows.listRequests(user.id, q.cursor, q.limit ?? 20);
  }

  @Post('me/follow-requests/:userId/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAuth()
  @ApiOperation({ summary: 'Approve a follow request' })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'Requester id' })
  @ApiNoContentResponse({ description: 'Request approved' })
  @ApiErrors(400, 404)
  async accept(@CurrentUser() user: AuthUser, @Param('userId', UuidPipe) requesterId: string): Promise<void> {
    await this.follows.acceptRequest(user.id, requesterId);
  }

  @Delete('me/follow-requests/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAuth()
  @ApiOperation({ summary: 'Decline a follow request (idempotent)' })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'Requester id' })
  @ApiNoContentResponse({ description: 'Request declined' })
  @ApiErrors(400)
  async reject(@CurrentUser() user: AuthUser, @Param('userId', UuidPipe) requesterId: string): Promise<void> {
    await this.follows.rejectRequest(user.id, requesterId);
  }

  @Delete('me/followers/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAuth()
  @ApiOperation({ summary: 'Remove a user from your followers (idempotent)' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Follower removed' })
  @ApiErrors(400)
  async removeFollower(@CurrentUser() user: AuthUser, @Param('userId', UuidPipe) followerId: string): Promise<void> {
    await this.follows.removeFollower(user.id, followerId);
  }

  @Get('me/suggestions')
  @ApiAuth()
  @ApiOperation({
    summary: 'Suggested accounts to follow',
    description:
      'Excludes yourself, accounts you follow or have requested, blocked accounts in either direction and ' +
      'inactive accounts. Ranked by mutual connections. Not paginated (max 20).',
  })
  @ApiOkResponse({ type: SuggestedUsersDto })
  @ApiErrors(400)
  async suggestions(@CurrentUser() user: AuthUser, @Query() q: SuggestionsQueryDto): Promise<SuggestedUsersDto> {
    return { items: await this.follows.suggestions(user.id, q.limit ?? 5) };
  }

  @Get('me/blocks')
  @ApiAuth()
  @ApiOperation({ summary: 'Users you have blocked' })
  @ApiOkResponse({ type: Paginated(BlockedUserDto) })
  @ApiErrors(400)
  listBlocks(@CurrentUser() user: AuthUser, @Query() q: CursorQueryDto): Promise<Page<BlockedUserDto>> {
    return this.follows.listBlocks(user.id, q.cursor, q.limit ?? 20);
  }

  // ---- Follow / block a user ----

  @Post(':id/follow')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({
    summary: 'Follow a user (idempotent)',
    description: 'For private accounts a follow request is created and `status` is REQUESTED.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FollowResultDto })
  @ApiErrors(400, 403, 404)
  follow(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<FollowResultDto> {
    return this.follows.follow(user.id, id);
  }

  @Delete(':id/follow')
  @ApiAuth()
  @ApiOperation({ summary: 'Unfollow a user or cancel a pending request (idempotent)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FollowResultDto })
  @ApiErrors(400, 404)
  unfollow(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<FollowResultDto> {
    return this.follows.unfollow(user.id, id);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({
    summary: 'Block a user (idempotent)',
    description: 'Removes follows and follow requests in both directions. Blocked users cannot see or interact with your content.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BlockResultDto })
  @ApiErrors(400, 404)
  async block(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<BlockResultDto> {
    await this.follows.block(user.id, id);
    return { isBlocking: true };
  }

  @Delete(':id/block')
  @ApiAuth()
  @ApiOperation({ summary: 'Unblock a user (idempotent)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BlockResultDto })
  @ApiErrors(400)
  async unblock(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<BlockResultDto> {
    await this.follows.unblock(user.id, id);
    return { isBlocking: false };
  }

  @Public()
  @Get(':id/followers')
  @ApiOptionalAuth()
  @ApiOperation({ summary: "List a user's followers (newest first)" })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Paginated(UserListItemDto) })
  @ApiErrors(400, 403, 404)
  followers(
    @Param('id', UuidPipe) id: string,
    @Viewer() viewer: AuthUser | null,
    @Query() q: CursorQueryDto,
  ): Promise<Page<UserListItemDto>> {
    return this.follows.listFollows('followers', id, viewer?.id ?? null, q.cursor, q.limit ?? 20);
  }

  @Public()
  @Get(':id/following')
  @ApiOptionalAuth()
  @ApiOperation({ summary: 'List users a user follows (newest first)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Paginated(UserListItemDto) })
  @ApiErrors(400, 403, 404)
  following(
    @Param('id', UuidPipe) id: string,
    @Viewer() viewer: AuthUser | null,
    @Query() q: CursorQueryDto,
  ): Promise<Page<UserListItemDto>> {
    return this.follows.listFollows('following', id, viewer?.id ?? null, q.cursor, q.limit ?? 20);
  }
}
