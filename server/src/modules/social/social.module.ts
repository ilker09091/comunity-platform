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
  Put,
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
  ChatThemeDto,
  ReactDto,
  TogetherDto,
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
  SharedMediaQueryDto,
  StickerDto,
  StoryDto,
  StoryReplyDto,
  StoryViewerDto, ChatGameDto, GameMoveDto, StartGameDto, ChatPrefsDto, ChatPrefsResultDto, BabyDto, BabyStateDto, StartBabyDto, BabyItemDto, BabyOutfitDto, BabyBuyDto, BabyPlaceDto, BabyPhotoDto, BabyTeachDto, BabyMemoriesDto, BabyHereDto, BabyTogetherDto, BabySendSignalDto } from './social.dto.js';
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
import { BabiesService } from './babies.service.js';

@ApiTags('Messages')
@ApiAuth()
@ApiErrors(400, 401, 403, 404)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService,private readonly audio:MessageAudioService,private readonly babies:BabiesService) {}
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
  @Get(':id/baby')
  @ApiOperation({operationId:'messagesBaby',summary:'The baby you raise with this user, or the open request'}) @ApiOkResponse({type:BabyStateDto})
  baby(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.messages.baby(u.id,id);}
  @Post(':id/baby')
  @ApiOperation({operationId:'messagesStartBaby',summary:'Ask this user to have a baby together; it arrives as a message'}) @ApiCreatedResponse({type:DirectMessageDto})
  startBaby(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:StartBabyDto){return this.messages.startBaby(u.id,id,dto.name,dto.gender);}
  @Post('baby/:babyId/accept') @HttpCode(200)
  @ApiOperation({operationId:'babyAccept',summary:'Accept the request: the baby is born'}) @ApiOkResponse({type:BabyDto})
  babyAccept(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string){return this.babies.accept(u.id,id);}
  @Post('baby/:babyId/decline') @HttpCode(204)
  @ApiOperation({operationId:'babyDecline',summary:'Decline or withdraw an open baby request'}) @ApiNoContentResponse()
  async babyDecline(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string){await this.babies.decline(u.id,id);}
  @Post('baby/:babyId/feed') @HttpCode(200)
  @ApiOperation({operationId:'babyFeed',summary:'Feed your baby (three times a day per parent)'}) @ApiOkResponse({type:BabyDto})
  babyFeed(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string,@Body() _dto:BabyItemDto){return this.babies.feed(u.id,id);}
  @Post('baby/:babyId/play') @HttpCode(200)
  @ApiOperation({operationId:'babyPlay',summary:'Play with your baby (three times a day per parent)'}) @ApiOkResponse({type:BabyDto})
  babyPlay(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string,@Body() dto:BabyItemDto){return this.babies.play(u.id,id,dto.item);}
  @Post('baby/:babyId/bath') @HttpCode(200)
  @ApiOperation({operationId:'babyBath',summary:'Give your baby a bath (twice a day per parent)'}) @ApiOkResponse({type:BabyDto})
  babyBath(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string){return this.babies.bath(u.id,id);}
  @Post('baby/:babyId/sleep') @HttpCode(200)
  @ApiOperation({operationId:'babySleep',summary:'Put your baby to bed'}) @ApiOkResponse({type:BabyDto})
  babySleep(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string){return this.babies.sleep(u.id,id);}
  @Post('baby/:babyId/wake') @HttpCode(200)
  @ApiOperation({operationId:'babyWake',summary:'Wake your baby up'}) @ApiOkResponse({type:BabyDto})
  babyWake(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string){return this.babies.wake(u.id,id);}
  @Post('baby/:babyId/hug') @HttpCode(200)
  @ApiOperation({operationId:'babyHug',summary:'Hug your baby; both parents within minutes is a family hug'}) @ApiOkResponse({type:BabyDto})
  babyHug(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string){return this.babies.hug(u.id,id);}
  @Post('baby/:babyId/medicine') @HttpCode(200)
  @ApiOperation({operationId:'babyMedicine',summary:'Give medicine for a cold (one dose per parent)'}) @ApiOkResponse({type:BabyDto})
  babyMedicine(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string){return this.babies.medicine(u.id,id);}
  @Post('baby/:babyId/shop') @HttpCode(200)
  @ApiOperation({operationId:'babyBuy',summary:'Buy a toy or decoration with the shared coins'}) @ApiOkResponse({type:BabyDto})
  babyBuy(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string,@Body() dto:BabyBuyDto){return this.babies.buy(u.id,id,dto.item);}
  @Put('baby/:babyId/decor')
  @ApiOperation({operationId:'babyPlace',summary:'Put up or take down a decoration you own'}) @ApiOkResponse({type:BabyDto})
  babyPlace(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string,@Body() dto:BabyPlaceDto){return this.babies.place(u.id,id,dto.slot,dto.item??null);}
  @Put('baby/:babyId/photo')
  @ApiOperation({operationId:'babyPhoto',summary:'Choose the photo in the frame (a photo from this chat)'}) @ApiOkResponse({type:BabyDto})
  babyPhoto(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string,@Body() dto:BabyPhotoDto){return this.babies.setPhoto(u.id,id,dto.messageId??null);}
  @Post('baby/:babyId/words') @HttpCode(200)
  @ApiOperation({operationId:'babyTeach',summary:'Teach your toddler a word'}) @ApiOkResponse({type:BabyDto})
  babyTeach(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string,@Body() dto:BabyTeachDto){return this.babies.teach(u.id,id,dto.word);}
  @Post('baby/:babyId/here') @HttpCode(200)
  @ApiOperation({operationId:'babyHere',summary:'Check in while the baby is open: where you are, and whether the other parent is here'}) @ApiOkResponse({type:BabyTogetherDto})
  babyHere(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string,@Body() dto:BabyHereDto){return this.babies.here(u.id,id,dto.scene,dto.since);}
  @Post('baby/:babyId/signal') @HttpCode(204)
  @ApiOperation({operationId:'babySignal',summary:'Send the other parent a heart, wave, kiss or star'}) @ApiNoContentResponse()
  async babySignal(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string,@Body() dto:BabySendSignalDto){await this.babies.signal(u.id,id,dto.kind);}
  @Get('baby/:babyId/memories')
  @ApiOperation({operationId:'babyMemories',summary:'The memory book and every word your child knows'}) @ApiOkResponse({type:BabyMemoriesDto})
  babyMemories(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string){return this.babies.memories(u.id,id);}
  @Put('baby/:babyId/outfit')
  @ApiOperation({operationId:'babyOutfit',summary:'Dress your baby (both parents see it)'}) @ApiOkResponse({type:BabyDto})
  babyOutfit(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string,@Body() dto:BabyOutfitDto){return this.babies.setOutfit(u.id,id,dto.outfit);}
  @Delete('baby/:babyId') @HttpCode(204)
  @ApiOperation({operationId:'babyEnd',summary:'Say goodbye to your baby, for both parents'}) @ApiNoContentResponse()
  async babyEnd(@CurrentUser() u:AuthUser,@Param('babyId',ParseUUIDPipe) id:string){await this.babies.end(u.id,id);}
  @Get('games/:gameId')
  @ApiOperation({operationId:'messagesGame',summary:'Current state of a mini game you play in'}) @ApiOkResponse({type:ChatGameDto})
  game(@CurrentUser() u:AuthUser,@Param('gameId',ParseUUIDPipe) id:string){return this.messages.game(u.id,id);}
  @Post('games/:gameId/move') @HttpCode(200)
  @ApiOperation({operationId:'messagesGameMove',summary:'Play a move: a cell (XOX), a column (Connect Four) or a pick (rock-paper-scissors)'})
  @ApiOkResponse({type:ChatGameDto})
  gameMove(@CurrentUser() u:AuthUser,@Param('gameId',ParseUUIDPipe) id:string,@Body() dto:GameMoveDto){return this.messages.move(u.id,id,dto);}
  @Post(':id/games')
  @ApiOperation({operationId:'messagesStartGame',summary:'Invite a user to a mini game; it arrives as a message'}) @ApiCreatedResponse({type:DirectMessageDto})
  startGame(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:StartGameDto){return this.messages.startGame(u.id,id,dto.kind,dto.lang);}
  @Put(':id/prefs')
  @ApiOperation({operationId:'messagesSetPrefs',summary:'Your private nickname and wallpaper for this conversation'}) @ApiOkResponse({type:ChatPrefsResultDto})
  setPrefs(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ChatPrefsDto){return this.messages.setPrefs(u.id,id,dto);}
  @Put(':id/reaction') @HttpCode(204)
  @ApiOperation({operationId:'messagesReact',summary:'React to a message with an emoji (replaces your previous reaction)'}) @ApiNoContentResponse()
  async react(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReactDto){await this.messages.react(u.id,id,dto.emoji);}
  @Delete(':id/reaction') @HttpCode(204)
  @ApiOperation({operationId:'messagesUnreact',summary:'Remove your reaction'}) @ApiNoContentResponse()
  async unreact(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){await this.messages.unreact(u.id,id);}
  @Get(':id/together')
  @ApiOperation({operationId:'messagesTogether',summary:'Shared stats for the conversation with a user'}) @ApiOkResponse({type:TogetherDto})
  together(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.messages.together(u.id,id);}
  @Put(':id/theme') @HttpCode(204)
  @ApiOperation({operationId:'messagesSetTheme',summary:'Set the chat theme for both people in this conversation'}) @ApiNoContentResponse()
  async setTheme(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ChatThemeDto){await this.messages.setTheme(u.id,id,dto.theme);}
  @Post(':id/favorite') @HttpCode(204)
  @ApiOperation({operationId:'messagesFavorite',summary:'Star a message (only you see your stars)'}) @ApiNoContentResponse()
  async favorite(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){await this.messages.favorite(u.id,id);}
  @Delete(':id/favorite') @HttpCode(204)
  @ApiOperation({operationId:'messagesUnfavorite',summary:'Remove the star from a message'}) @ApiNoContentResponse()
  async unfavorite(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){await this.messages.unfavorite(u.id,id);}
  @Get(':id/favorites')
  @ApiOperation({operationId:'messagesFavorites',summary:'Your starred messages with a user, most recently starred first'})
  @ApiOkResponse({type:Paginated(DirectMessageDto)})
  favorites(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query() q:CursorQueryDto){return this.messages.favorites(u.id,id,q.cursor,q.limit??30);}
  @Get(':id/media')
  @ApiOperation({operationId:'messagesSharedMedia',summary:'Photos, videos and GIFs (or links) shared with a user, newest first'})
  @ApiOkResponse({type:Paginated(DirectMessageDto)})
  sharedMedia(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query() q:SharedMediaQueryDto){return this.messages.sharedMedia(u.id,id,q.kind??'media',q.cursor,q.limit??30);}
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
  providers: [MessagesService, BabiesService, GroupsService, MessageAudioService, StoriesService, StickersService, NotesService, PushService, CallsService, StreaksService],
})
export class SocialModule {}
