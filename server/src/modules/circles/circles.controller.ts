import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthUser } from '../../common/decorators/auth.decorators.js';
import { CursorQueryDto, Paginated } from '../../common/dto/common.dto.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import {
  CircleAlbumDto,
  CircleDto,
  CircleInviteDto,
  CircleMemberDto,
  CirclePostDto,
  CirclePromptDto,
  CircleRoleDto,
  CreateCircleAlbumDto,
  CreateCircleDto,
  CreateCirclePostDto,
  CreateCirclePromptDto,
  JoinCircleDto,
  UpdateCircleDto,
} from './circles.dto.js';
import { CirclesService } from './circles.service.js';

const Id = () => Param('id', ParseUUIDPipe);

@ApiTags('Circles') @ApiAuth() @ApiErrors(400, 401, 403, 404, 409)
@Controller('circles')
export class CirclesController {
  constructor(private readonly circles: CirclesService) {}

  @Get() @ApiOperation({ operationId: 'circlesList', summary: 'Your circles, most recently active first' }) @ApiOkResponse({ type: [CircleDto] })
  list(@CurrentUser() u: AuthUser) { return this.circles.list(u.id); }
  @Post() @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @ApiOperation({ operationId: 'circlesCreate', summary: 'Create a circle; you become its owner' }) @ApiCreatedResponse({ type: CircleDto })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCircleDto) { return this.circles.create(u.id, dto); }
  @Get('invites/:code') @ApiOperation({ operationId: 'circlesInvite', summary: 'Preview a circle from its invite code' }) @ApiOkResponse({ type: CircleInviteDto })
  invite(@CurrentUser() u: AuthUser, @Param('code') code: string) { return this.circles.invite(u.id, code.slice(0, 10)); }
  @Post('join') @HttpCode(200) @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ operationId: 'circlesJoin', summary: 'Join with an invite code' }) @ApiOkResponse({ type: CircleDto })
  join(@CurrentUser() u: AuthUser, @Body() dto: JoinCircleDto) { return this.circles.join(u.id, dto.code); }

  @Get(':id') @ApiOperation({ operationId: 'circlesGet', summary: 'A circle you belong to; marks it as seen' }) @ApiOkResponse({ type: CircleDto })
  get(@CurrentUser() u: AuthUser, @Id() id: string) { return this.circles.get(u.id, id); }
  @Patch(':id') @ApiOperation({ operationId: 'circlesUpdate', summary: 'Edit name, look and rules (admins)' }) @ApiOkResponse({ type: CircleDto })
  update(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: UpdateCircleDto) { return this.circles.update(u.id, id, dto); }
  @Delete(':id') @HttpCode(204) @ApiOperation({ operationId: 'circlesDelete', summary: 'Delete the circle and everything in it (owner)' }) @ApiNoContentResponse()
  async remove(@CurrentUser() u: AuthUser, @Id() id: string) { await this.circles.remove(u.id, id); }
  @Post(':id/invite/reset') @HttpCode(200) @ApiOperation({ operationId: 'circlesResetInvite', summary: 'Replace the invite link; the old one stops working' }) @ApiOkResponse({ type: CircleDto })
  resetInvite(@CurrentUser() u: AuthUser, @Id() id: string) { return this.circles.resetInvite(u.id, id); }
  @Post(':id/leave') @HttpCode(204) @ApiOperation({ operationId: 'circlesLeave', summary: 'Leave; ownership passes on, the last person out deletes the circle' }) @ApiNoContentResponse()
  async leave(@CurrentUser() u: AuthUser, @Id() id: string) { await this.circles.leave(u.id, id); }

  @Get(':id/members') @ApiOperation({ operationId: 'circlesMembers', summary: 'Members with roles and today’s streak contribution' }) @ApiOkResponse({ type: [CircleMemberDto] })
  members(@CurrentUser() u: AuthUser, @Id() id: string) { return this.circles.members(u.id, id); }
  @Post(':id/members/:userId/role') @HttpCode(200) @ApiOperation({ operationId: 'circlesSetRole', summary: 'Make someone an admin/member, or hand over ownership (owner)' }) @ApiOkResponse({ type: [CircleMemberDto] })
  setRole(@CurrentUser() u: AuthUser, @Id() id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: CircleRoleDto) {
    return this.circles.setRole(u.id, id, userId, dto.role);
  }
  @Delete(':id/members/:userId') @HttpCode(204) @ApiOperation({ operationId: 'circlesRemoveMember', summary: 'Remove someone with a lower role' }) @ApiNoContentResponse()
  async removeMember(@CurrentUser() u: AuthUser, @Id() id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.circles.removeMember(u.id, id, userId);
  }

  @Get(':id/posts') @ApiOperation({ operationId: 'circlesFeed', summary: 'The circle feed, newest first' }) @ApiOkResponse({ type: Paginated(CirclePostDto) })
  feed(@CurrentUser() u: AuthUser, @Id() id: string, @Query() q: CursorQueryDto) { return this.circles.feed(u.id, id, q.cursor, q.limit ?? 20); }
  @Post(':id/posts') @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ operationId: 'circlesCreatePost', summary: 'Post, answer today’s question or add to an album; counts toward the streak' })
  @ApiCreatedResponse({ type: CirclePostDto })
  createPost(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CreateCirclePostDto) { return this.circles.createPost(u.id, id, dto); }
  @Delete(':id/posts/:postId') @HttpCode(204) @ApiOperation({ operationId: 'circlesDeletePost', summary: 'Delete your post (admins: any post)' }) @ApiNoContentResponse()
  async deletePost(@CurrentUser() u: AuthUser, @Id() id: string, @Param('postId', ParseUUIDPipe) postId: string) {
    await this.circles.deletePost(u.id, id, postId);
  }

  @Get(':id/today') @ApiOperation({ operationId: 'circlesToday', summary: 'Today’s question; answers unlock after you answer' }) @ApiOkResponse({ type: CirclePromptDto })
  today(@CurrentUser() u: AuthUser, @Id() id: string) { return this.circles.today(u.id, id); }
  @Get(':id/prompts') @ApiOperation({ operationId: 'circlesPromptHistory', summary: 'Earlier questions and everyone’s answers' }) @ApiOkResponse({ type: Paginated(CirclePromptDto) })
  history(@CurrentUser() u: AuthUser, @Id() id: string, @Query() q: CursorQueryDto) { return this.circles.history(u.id, id, q.cursor, Math.min(q.limit ?? 10, 20)); }
  @Post(':id/prompts') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ operationId: 'circlesSetPrompt', summary: 'Ask your own question: today if unanswered, else tomorrow (admins)' })
  @ApiCreatedResponse({ type: CirclePromptDto })
  setPrompt(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CreateCirclePromptDto) { return this.circles.setPrompt(u.id, id, dto); }

  @Get(':id/albums') @ApiOperation({ operationId: 'circlesAlbums', summary: 'Shared albums, newest first' }) @ApiOkResponse({ type: Paginated(CircleAlbumDto) })
  albums(@CurrentUser() u: AuthUser, @Id() id: string, @Query() q: CursorQueryDto) { return this.circles.albums(u.id, id, q.cursor, q.limit ?? 20); }
  @Post(':id/albums') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ operationId: 'circlesCreateAlbum', summary: 'Open an album that accepts uploads for a limited time' }) @ApiCreatedResponse({ type: CircleAlbumDto })
  createAlbum(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CreateCircleAlbumDto) { return this.circles.createAlbum(u.id, id, dto); }
  @Get(':id/albums/:albumId/items') @ApiOperation({ operationId: 'circlesAlbumItems', summary: 'Photos and videos in an album' }) @ApiOkResponse({ type: Paginated(CirclePostDto) })
  albumItems(@CurrentUser() u: AuthUser, @Id() id: string, @Param('albumId', ParseUUIDPipe) albumId: string, @Query() q: CursorQueryDto) {
    return this.circles.albumItems(u.id, id, albumId, q.cursor, q.limit ?? 30);
  }
  @Delete(':id/albums/:albumId') @HttpCode(204) @ApiOperation({ operationId: 'circlesDeleteAlbum', summary: 'Delete an album (its creator or admins)' }) @ApiNoContentResponse()
  async deleteAlbum(@CurrentUser() u: AuthUser, @Id() id: string, @Param('albumId', ParseUUIDPipe) albumId: string) {
    await this.circles.deleteAlbum(u.id, id, albumId);
  }
}
