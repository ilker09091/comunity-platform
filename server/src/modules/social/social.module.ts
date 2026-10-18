import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import {
  ApiAuth,
  ApiErrors,
} from '../../common/swagger/api-docs.decorators.js';
import {
  CountDto,
  CursorQueryDto,
  Paginated,
} from '../../common/dto/common.dto.js';
import { MediaModule } from '../media/media.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { UsersModule } from '../users/users.module.js';
import {
  ConversationDto,
  ConversationQueryDto,
  CreateStickerDto,
  CreateStoryDto,
  DirectMessageDto,
  MessageStatusDto,
  SendMessageDto,
  StickerDto,
  StoryDto,
  StoryReplyDto,
  StoryViewerDto,
} from './social.dto.js';
import { MessagesService } from './messages.service.js';
import { StickersService } from './stickers.service.js';
import { StoriesService } from './stories.service.js';

@ApiTags('Messages')
@ApiAuth()
@ApiErrors(400, 401, 403, 404)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}
  @Get()
  @ApiOperation({
    operationId: 'messagesConversations',
    summary: 'Conversations, most recently active first',
  })
  @ApiOkResponse({ type: Paginated(ConversationDto) })
  list(@CurrentUser() u: AuthUser, @Query() q: ConversationQueryDto) {
    return this.messages.conversations(
      u.id,
      q.cursor,
      q.limit ?? 20,
      q.folder,
    );
  }
  @Get('unread-count')
  @ApiOperation({
    operationId: 'messagesUnread',
    summary: 'Unread direct messages',
  })
  @ApiOkResponse({ type: CountDto })
  unread(@CurrentUser() u: AuthUser) {
    return this.messages.unread(u.id);
  }
  @Get(':id')
  @ApiOperation({
    operationId: 'messagesList',
    summary: 'Messages exchanged with a user, newest first',
  })
  @ApiOkResponse({ type: Paginated(DirectMessageDto) })
  thread(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: CursorQueryDto,
  ) {
    return this.messages.list(u.id, id, q.cursor, q.limit ?? 30);
  }
  @Post(':id')
  @ApiOperation({
    operationId: 'messagesSend',
    summary: 'Send text, an uploaded video, or a post/Reel to a user',
  })
  @ApiCreatedResponse({ type: DirectMessageDto })
  send(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.send(u.id, id, dto);
  }
  @Get(':id/status')
  @ApiOperation({
    operationId: 'messagesStatus',
    summary: 'Message request state of a conversation and whether you can send',
  })
  @ApiOkResponse({ type: MessageStatusDto })
  status(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.messages.status(u.id, id);
  }
  @Post(':id/accept')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'messagesAccept',
    summary: 'Accept a message request so the sender can keep chatting',
  })
  @ApiNoContentResponse()
  async accept(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.messages.accept(u.id, id);
  }
  @Delete(':id/request')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'messagesDecline',
    summary: 'Delete a message request',
  })
  @ApiNoContentResponse()
  async decline(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.messages.decline(u.id, id);
  }
  @Post(':id/read')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'messagesRead',
    summary: 'Mark received messages through the specified message as read',
  })
  @ApiNoContentResponse()
  async read(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.messages.read(u.id, id);
  }
}
@ApiTags('Stories')
@ApiAuth()
@ApiErrors(400, 401, 403, 404)
@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}
  @Get()
  @ApiOperation({
    operationId: 'storiesList',
    summary: 'Active stories from yourself and accounts you follow',
  })
  @ApiOkResponse({ type: Paginated(StoryDto) })
  list(@CurrentUser() u: AuthUser, @Query() q: CursorQueryDto) {
    return this.stories.list(u.id, q.cursor, q.limit ?? 50);
  }
  @Post()
  @ApiOperation({
    operationId: 'storiesCreate',
    summary: 'Publish a photo or video (up to 60 seconds) for 24 hours',
  })
  @ApiCreatedResponse({ type: StoryDto })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateStoryDto) {
    return this.stories.create(u.id, dto);
  }
  @Post(':id/view')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'storiesView',
    summary: 'Record a story view once per viewer',
  })
  @ApiNoContentResponse()
  async view(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.stories.view(u.id, id);
  }
  @Post(':id/like')
  @HttpCode(204)
  @ApiOperation({ operationId: 'storiesLike', summary: 'Like a story' })
  @ApiNoContentResponse()
  async like(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.stories.like(u.id, id);
  }
  @Delete(':id/like')
  @HttpCode(204)
  @ApiOperation({ operationId: 'storiesUnlike', summary: 'Remove your like' })
  @ApiNoContentResponse()
  async unlike(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.stories.unlike(u.id, id);
  }
  @Post(':id/reply')
  @ApiOperation({
    operationId: 'storiesReply',
    summary: 'Reply to a story with a direct message to its author',
  })
  @ApiCreatedResponse({ type: DirectMessageDto })
  reply(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StoryReplyDto,
  ) {
    return this.stories.reply(u.id, id, dto.content);
  }
  @Get(':id/viewers')
  @ApiOperation({
    operationId: 'storiesViewers',
    summary: 'Who viewed and liked your story, most recent first',
  })
  @ApiOkResponse({ type: Paginated(StoryViewerDto) })
  viewers(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: CursorQueryDto,
  ) {
    return this.stories.viewers(u.id, id, q.cursor, q.limit ?? 50);
  }
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'storiesDelete',
    summary: 'Delete your story and its media',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.stories.remove(u.id, id);
  }
}
@ApiTags('Stickers')
@ApiAuth()
@ApiErrors(400, 401, 403, 404, 409)
@Controller('stickers')
export class StickersController {
  constructor(private readonly stickers: StickersService) {}
  @Get()
  @ApiOperation({
    operationId: 'stickersList',
    summary: 'The built-in sticker pack and your own stickers',
  })
  @ApiOkResponse({ type: StickerDto, isArray: true })
  list(@CurrentUser() u: AuthUser) {
    return this.stickers.list(u.id);
  }
  @Post()
  @ApiOperation({
    operationId: 'stickersCreate',
    summary: 'Create a sticker from an uploaded photo',
  })
  @ApiCreatedResponse({ type: StickerDto })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateStickerDto) {
    return this.stickers.create(u.id, dto);
  }
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'stickersDelete',
    summary: 'Delete one of your stickers (comments that used it keep it)',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.stickers.remove(u.id, id);
  }
}
@Module({
  imports: [MediaModule, UsersModule, PostsModule],
  controllers: [MessagesController, StoriesController, StickersController],
  providers: [MessagesService, StoriesService, StickersService],
})
export class SocialModule {}
