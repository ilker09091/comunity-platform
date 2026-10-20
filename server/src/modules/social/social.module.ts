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
  Patch,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
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
import { GifsModule } from '../gifs/gifs.js';
import { MediaDto } from '../media/dto/media.dto.js';
import { UploadsMulterModule } from '../media/multer.options.js';
import { PostsModule } from '../posts/posts.module.js';
import { UsersModule } from '../users/users.module.js';
import {
  ConversationDto,
  ConversationQueryDto,
  CreateNoteDto,
  CreateStickerDto,
  CreateStoryDto,
  DirectMessageDto,
  EditMessageDto,
  MessageStatusDto,
  MessagePeerDto,
  MessageDeliveryDto,
  MessageAudioDto,
  MessageAudioUploadDto,
  NoteAudioDto,
  NoteAudioFieldsDto,
  NoteAudioUploadDto,
  NoteDto,
  PushKeyDto,
  PushSubscriptionDto,
  PushTestDto,
  PushUnsubscribeDto,
  SendMessageDto,
  StickerDto,
  StoryDto,
  StoryReplyDto,
  StoryViewerDto,
} from './social.dto.js';
import { MessagesService } from './messages.service.js';
import { MessageAudioService } from './message-audio.service.js';
import { CallsController, StreaksController } from './calls.controller.js';
import { CallsService } from './calls.service.js';
import { StreaksService } from './streaks.service.js';
import { NotesService } from './notes.service.js';
import { PushService } from './push.service.js';
import { StickersService } from './stickers.service.js';
import { StoriesService } from './stories.service.js';
import { GroupsService } from './groups.service.js';
import { GroupsController } from './groups.controller.js';

@ApiTags('Messages')
@ApiAuth()
@ApiErrors(400, 401, 403, 404)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService,private readonly audio:MessageAudioService) {}
  @Patch(':id')
  @ApiOperation({operationId:'messagesEdit',summary:'Edit the text of your own message'})
  @ApiOkResponse({type:DirectMessageDto})
  edit(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:EditMessageDto){return this.messages.editMessage(u.id,id,dto.content);}
  @Get('delivery')
  @ApiOperation({operationId:'messagesPendingDelivery',summary:'IDs awaiting device acknowledgment; does not change receipts'})
  @ApiOkResponse({type:MessageDeliveryDto})
  pendingDelivery(@CurrentUser() u:AuthUser){return this.messages.pendingDelivery(u.id);}
  @Post('delivery') @HttpCode(204)
  @ApiOperation({operationId:'messagesDelivered',summary:'Acknowledge only messages this recipient device has received'})
  @ApiNoContentResponse()
  delivered(@CurrentUser() u:AuthUser,@Body() dto:MessageDeliveryDto){return this.messages.delivered(u.id,dto.messageIds,dto.groupMessageIds);}
  @Post('audio') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1,fields:0}}))
  @ApiConsumes('multipart/form-data') @ApiBody({type:MessageAudioUploadDto})
  @ApiOperation({operationId:'messagesUploadAudio',summary:'Normalize a voice recording for a direct message'})
  @ApiCreatedResponse({type:MessageAudioDto})
  uploadAudio(@CurrentUser() u:AuthUser,@UploadedFile() file:Express.Multer.File|undefined){return this.audio.upload(u.id,file);}
  @Delete('audio/:id') @HttpCode(204)
  @ApiOperation({operationId:'messagesDeleteAudio',summary:'Discard an unsent voice recording'}) @ApiNoContentResponse()
  removeAudio(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.audio.remove(u.id,id);}
  @Get('peer/:username')
  @ApiOperation({operationId:'messagesPeer',summary:'Conversation identity; a blocked historical thread exposes no profile details'})
  @ApiOkResponse({type:MessagePeerDto})
  peer(@CurrentUser() u:AuthUser,@Param('username') username:string) {return this.messages.peer(u.id,username);}
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
  @Post(':id/typing')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'messagesTyping',
    summary: 'Tell this user you are typing (lasts a few seconds)',
  })
  @ApiNoContentResponse()
  async typing(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.messages.typing(u.id, id);
  }
  @Delete(':id/typing')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'messagesStopTyping',
    summary: 'Stop the typing indicator',
  })
  @ApiNoContentResponse()
  async stopTyping(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.messages.stopTyping(u.id, id);
  }
  @Post(':id/open')
  @ApiOperation({
    operationId: 'messagesOpen',
    summary: 'Open a view-once photo or video you received (works once)',
  })
  @ApiCreatedResponse({ type: MediaDto })
  open(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.messages.open(u.id, id);
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
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'messagesDelete',
    summary: 'Unsend one of your messages (deleted for both people)',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.messages.removeMessage(u.id, id);
  }
  @Delete(':id/conversation')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'messagesDeleteConversation',
    summary: 'Delete the whole conversation with this user, for both people',
  })
  @ApiNoContentResponse()
  async removeConversation(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.messages.removeConversation(u.id, id);
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
  @Post(':id/favorite') @HttpCode(204)
  @ApiOperation({operationId:'stickersFavorite',summary:'Save your own or a received sticker to favorites'}) @ApiNoContentResponse()
  favorite(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.stickers.favorite(u.id,id);}
  @Delete(':id/favorite') @HttpCode(204)
  @ApiOperation({operationId:'stickersUnfavorite',summary:'Remove a sticker from your favorites'}) @ApiNoContentResponse()
  unfavorite(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.stickers.unfavorite(u.id,id);}
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
@ApiTags('Notes')
@ApiAuth()
@ApiErrors(400, 401, 403, 404, 415)
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}
  @Get()
  @ApiOperation({
    operationId: 'notesList',
    summary: 'Your note and notes from accounts you follow (24 h)',
  })
  @ApiOkResponse({ type: NoteDto, isArray: true })
  list(@CurrentUser() u: AuthUser) {
    return this.notes.list(u.id);
  }
  @Post()
  @ApiOperation({
    operationId: 'notesCreate',
    summary: 'Share a note (replaces your current one)',
  })
  @ApiCreatedResponse({ type: NoteDto })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateNoteDto) {
    return this.notes.create(u.id, dto);
  }
  @Delete('me')
  @HttpCode(204)
  @ApiOperation({ operationId: 'notesDelete', summary: 'Delete your note' })
  @ApiNoContentResponse()
  async remove(@CurrentUser() u: AuthUser) {
    await this.notes.remove(u.id);
  }
  @Post(':id/reply')
  @ApiOperation({
    operationId: 'notesReply',
    summary: "Reply to someone's note with a direct message",
  })
  @ApiCreatedResponse({ type: DirectMessageDto })
  reply(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StoryReplyDto,
  ) {
    return this.notes.reply(u.id, id, dto.content);
  }
  @Post('audio')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    operationId: 'notesUploadAudio',
    summary: 'Upload a song and keep a 15 second clip for your note',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: NoteAudioUploadDto })
  @ApiCreatedResponse({ type: NoteAudioDto })
  uploadAudio(
    @CurrentUser() u: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: NoteAudioFieldsDto,
  ) {
    return this.notes.uploadAudio(u.id, file, dto.startMs);
  }
}
@ApiTags('Push')
@ApiAuth()
@ApiErrors(400, 401)
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}
  @Get('key')
  @ApiOperation({ operationId: 'pushKey', summary: 'VAPID public key for PushManager.subscribe' })
  @ApiOkResponse({ type: PushKeyDto })
  async key() {
    return { publicKey: await this.push.publicKey() };
  }
  @Post('subscriptions')
  @HttpCode(204)
  @ApiOperation({ operationId: 'pushSubscribe', summary: 'Receive message notifications on this device' })
  @ApiNoContentResponse()
  async subscribe(@CurrentUser() u: AuthUser, @Body() dto: PushSubscriptionDto) {
    await this.push.subscribe(u.id, dto);
  }
  @Post('subscriptions/remove')
  @HttpCode(204)
  @ApiOperation({ operationId: 'pushUnsubscribe', summary: 'Stop notifications on this device' })
  @ApiNoContentResponse()
  async unsubscribe(@CurrentUser() u: AuthUser, @Body() dto: PushUnsubscribeDto) {
    await this.push.unsubscribe(u.id, dto.endpoint);
  }
  @Post('test')
  @ApiOperation({ operationId: 'pushTest', summary: 'Send a test notification to your devices' })
  @ApiCreatedResponse({ type: PushTestDto })
  async test(@CurrentUser() u: AuthUser) {
    return { delivered: await this.push.send(u.id, 'test') };
  }
}
@Module({
  imports: [MediaModule, UsersModule, PostsModule, UploadsMulterModule, GifsModule],
  controllers: [MessagesController, GroupsController, StoriesController, StickersController, NotesController, PushController, CallsController, StreaksController],
  providers: [MessagesService, GroupsService, MessageAudioService, StoriesService, StickersService, NotesService, PushService, CallsService, StreaksService],
})
export class SocialModule {}
