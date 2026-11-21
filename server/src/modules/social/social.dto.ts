import { GIF_ID, GifDto } from '../gifs/gifs.js';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Matches,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CursorQueryDto } from '../../common/dto/common.dto.js';
import { GAME_KINDS, type GameKind } from '../../database/migrations/1760193400000-TalkGames.js';
import { CHAT_THEMES, type ChatTheme } from '../../database/migrations/1760192700000-StrictStreaksAndChatThemes.js';
import { SanitizedText } from '../../common/utils/sanitize.js';
import { MediaDto } from '../media/dto/media.dto.js';
import { PostDto } from '../posts/dto/post.dto.js';
import { DECOR_SLOTS, SCENES, SHOP_IDS, SIGNALS, type DecorSlot, type Scene, type Signal } from './baby.js';
import { UserSummaryDto } from '../users/dto/user.dto.js';

export class SendMessageDto {
  @ApiPropertyOptional({format:'uuid'}) @IsOptional() @IsUUID('all') stickerId?: string;
  @ApiPropertyOptional({ description: 'GIF id from GET /gifs' }) @IsOptional() @IsString() @Matches(GIF_ID) gifId?: string;
  @ApiPropertyOptional({format:'uuid',description:'A recorded voice clip uploaded by this account'})
  @IsOptional() @IsUUID('all') audioId?: string;
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @SanitizedText({ multiline: true })
  content?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  mediaId?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Share an existing post or Reel',
  })
  @IsOptional()
  @IsUUID('all')
  postId?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Quote a message from this conversation',
  })
  @IsOptional()
  @IsUUID('all')
  replyToId?: string;
  @ApiPropertyOptional({
    description: 'The attached photo/video can be opened once by the recipient',
  })
  @IsOptional()
  @IsBoolean()
  viewOnce?: boolean;
}
export class MessageReplyRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) senderId: string;
  @ApiProperty({
    enum: ['TEXT', 'PHOTO', 'VIDEO', 'POST', 'STORY', 'VIEW_ONCE', 'STICKER', 'AUDIO', 'CALL', 'GIF', 'GAME', 'BABY', 'UNAVAILABLE'],
  })
  kind: 'TEXT' | 'PHOTO' | 'VIDEO' | 'POST' | 'STORY' | 'VIEW_ONCE' | 'STICKER' | 'AUDIO' | 'CALL' | 'GIF' | 'GAME' | 'BABY' | 'UNAVAILABLE';
  @ApiProperty({ type: String, nullable: true, description: 'Up to 140 characters' })
  preview: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Length of a quoted voice message' })
  audioDurationMs: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'Small picture of a quoted photo, sticker or GIF' })
  thumbnailUrl: string | null;
}
export class StoryReplyRefDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'null once the story is gone',
  })
  storyId: string | null;
  @ApiProperty({
    type: MediaDto,
    nullable: true,
    description: 'Story preview while it is still live',
  })
  media: MediaDto | null;
}
export class NoteReplyRefDto {
  @ApiProperty({ description: 'The note text when the reply was sent' }) text: string;
  @ApiProperty({ type: String, nullable: true }) songTitle: string | null;
}
export class CallLogDto {
  @ApiProperty({ enum: ['audio', 'video'] }) kind: 'audio' | 'video';
  @ApiProperty({
    enum: ['completed', 'missed', 'declined', 'cancelled'],
    description: 'completed: answered; cancelled: the caller hung up before an answer',
  })
  status: 'completed' | 'missed' | 'declined' | 'cancelled';
  @ApiProperty({ type: Number, nullable: true, description: 'Talk time of an answered call' })
  durationSeconds: number | null;
}
export class DirectMessageDto {
  @ApiProperty({type:String,nullable:true,format:'date-time'}) editedAt: string|null;
  @ApiProperty({ type: () => GifDto, nullable: true }) gif: GifDto | null;
  @ApiProperty({ type: CallLogDto, nullable: true, description: 'Set on call history entries; the sender is the caller' })
  call: CallLogDto | null;
  @ApiProperty({type:()=>StickerDto,nullable:true}) sticker: StickerDto|null;
  @ApiProperty() hasSticker: boolean;
  @ApiProperty({type:String,nullable:true}) audioUrl: string|null;
  @ApiProperty({type:Number,nullable:true}) audioDurationMs: number|null;
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) senderId: string;
  @ApiProperty({ format: 'uuid' }) recipientId: string;
  @ApiProperty({ type: String, nullable: true }) content: string | null;
  @ApiProperty({
    type: MediaDto,
    nullable: true,
    description: 'Never set for view-once messages; the recipient opens them once',
  })
  media: MediaDto | null;
  @ApiProperty({ type: PostDto, nullable: true }) post: PostDto | null;
  @ApiProperty({ type: MessageReplyRefDto, nullable: true })
  replyTo: MessageReplyRefDto | null;
  @ApiProperty() viewOnce: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['IMAGE', 'VIDEO'],
    description: 'Kind of a view-once attachment while it can still be opened',
  })
  viewOnceType: 'IMAGE' | 'VIDEO' | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  openedAt: string | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: "Reached the recipient's device (second tick)",
  })
  deliveredAt: string | null;
  @ApiProperty({
    type: StoryReplyRefDto,
    nullable: true,
    description: 'Set when this message replies to a story',
  })
  storyReply: StoryReplyRefDto | null;
  @ApiProperty({
    type: NoteReplyRefDto,
    nullable: true,
    description: 'Set when this message replies to a note',
  })
  noteReply: NoteReplyRefDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) readAt:
    string | null;
  @ApiProperty({ description: 'Starred by the viewer (private to them)' }) isFavorite: boolean;
  @ApiProperty({ type: () => MessageReactionDto, isArray: true }) reactions: MessageReactionDto[];
  @ApiProperty({ type: () => ChatGameDto, nullable: true, description: 'Set when this message is a mini game' })
  game: ChatGameDto | null;
  @ApiProperty({ type: () => BabyInviteDto, nullable: true, description: 'Set when this message asks to have a baby together' })
  baby: BabyInviteDto | null;
}
export class BabyInviteDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['girl', 'boy'] }) gender: 'girl' | 'boy';
  @ApiProperty({ enum: ['pending', 'active', 'declined', 'ended'] }) status: 'pending' | 'active' | 'declined' | 'ended';
  @ApiProperty({ format: 'uuid' }) requestedBy: string;
}
export class BabyCareDto {
  @ApiProperty() feeds: number;
  @ApiProperty() plays: number;
  @ApiProperty() chats: number;
  @ApiProperty() games: number;
  @ApiProperty() baths: number;
  @ApiProperty() sleeps: number;
}
export class BabyDecorStateDto {
  @ApiProperty({ type: String, nullable: true, description: 'Room theme item id; null is the default room' }) room: string | null;
  @ApiProperty({ type: String, nullable: true }) hang: string | null;
  @ApiProperty({ type: String, nullable: true }) floor: string | null;
  @ApiProperty({ type: String, nullable: true, description: '"frame" when the photo frame hangs on the wall' }) frame: string | null;
}
export class BabyMomentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['born', 'stage', 'word', 'firsthug', 'healed', 'bought'] }) kind: string;
  @ApiProperty({ type: Number, nullable: true, description: 'Stage at that moment (born, stage)' }) stage: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Outfit at that moment (born, stage)' }) outfit: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'The word (word)' }) word: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Shop item id (bought)' }) item: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'Parent who made it happen, if one did' }) byId: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class BabyWordDto {
  @ApiProperty() word: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) taughtBy: string | null;
  @ApiProperty({ format: 'date-time' }) learnedAt: string;
}
export class BabyMemoriesDto {
  @ApiProperty({ type: () => BabyMomentDto, isArray: true, description: 'Newest first' }) moments: BabyMomentDto[];
  @ApiProperty({ type: () => BabyWordDto, isArray: true, description: 'Newest first' }) words: BabyWordDto[];
}
export class BabyDto extends BabyInviteDto {
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) bornAt: string | null;
  @ApiProperty({ description: 'Whole days since birth' }) ageDays: number;
  @ApiProperty() xp: number;
  @ApiProperty({ description: '1 baby, 2 toddler, 3 child, 4 big kid' }) stage: number;
  @ApiProperty() stageName: string;
  @ApiProperty({ description: 'XP where the current stage started' }) stageXp: number;
  @ApiProperty({ type: Number, nullable: true, description: 'XP for the next stage; null at the last stage' }) nextStageXp: number | null;
  @ApiProperty({ description: '0-100, runs down over about 16 hours' }) fullness: number;
  @ApiProperty({ description: '0-100, runs down over about 36 hours' }) happiness: number;
  @ApiProperty({ description: '0-100, runs down over about 40 hours; a bath fills it' }) clean: number;
  @ApiProperty({ description: '0-100: runs down while awake, fills up while asleep' }) energy: number;
  @ApiProperty() asleep: boolean;
  @ApiProperty({ description: 'Has a cold: grows at half speed until both parents give medicine' }) sick: boolean;
  @ApiProperty({ description: 'You already gave medicine for this cold' }) medicineMine: boolean;
  @ApiProperty({ description: 'The other parent already gave medicine for this cold' }) medicineTheirs: boolean;
  @ApiProperty({ enum: ['happy', 'hungry', 'sad', 'sick', 'sleepy', 'dirty'] }) mood: 'happy' | 'hungry' | 'sad' | 'sick' | 'sleepy' | 'dirty';
  @ApiProperty({ description: 'Shared piggy bank' }) coins: number;
  @ApiProperty({ type: String, isArray: true, description: 'Shop items bought' }) owned: string[];
  @ApiProperty({ type: () => BabyDecorStateDto }) decor: BabyDecorStateDto;
  @ApiProperty({ type: String, nullable: true, description: 'Photo in the frame on the wall' }) photoUrl: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) myHugAt: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) theirHugAt: string | null;
  @ApiProperty({ description: 'You both hugged within a few minutes of each other today' }) familyHugToday: boolean;
  @ApiProperty() familyHugs: number;
  @ApiProperty({ type: String, isArray: true, description: 'Words the child can say, newest first (up to 40)' }) words: string[];
  @ApiProperty({ type: () => BabyMomentDto, nullable: true, description: 'Newest page of the memory book' }) latestMoment: BabyMomentDto | null;
  @ApiProperty({ description: 'Outfit index 0-5 for the current stage' }) outfit: number;
  @ApiProperty({ type: () => BabyCareDto, description: 'What you did today (UTC day)' }) mine: BabyCareDto;
  @ApiProperty({ type: () => BabyCareDto, description: 'What the other parent did today' }) theirs: BabyCareDto;
  @ApiProperty({ type: () => BabyCareDto, description: 'Daily limits per parent' }) limits: BabyCareDto;
}
export class BabyStateDto {
  @ApiProperty({ type: () => BabyDto, nullable: true, description: 'The open request or the child you raise together' })
  baby: BabyDto | null;
}
export class StartBabyDto {
  @ApiProperty({ minLength: 1, maxLength: 24 }) @IsString() @MinLength(1) @MaxLength(24) @SanitizedText() name: string;
  @ApiProperty({ enum: ['girl', 'boy'] }) @IsIn(['girl', 'boy']) gender: 'girl' | 'boy';
}
export class BabyItemDto {
  @ApiProperty({ description: 'Food (0-11) or toy (0-5) index' }) @Type(() => Number) @IsInt() @Min(0) @Max(11) item: number;
}
export class BabyBuyDto {
  @ApiProperty({ enum: SHOP_IDS }) @IsIn(SHOP_IDS) item: string;
}
export class BabyPlaceDto {
  @ApiProperty({ enum: DECOR_SLOTS }) @IsIn([...DECOR_SLOTS]) slot: DecorSlot;
  @ApiProperty({ type: String, nullable: true, enum: SHOP_IDS, description: 'An item you own for that slot; null clears it' })
  @IsOptional() @IsIn(SHOP_IDS) item: string | null;
}
export class BabyPhotoDto {
  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'A photo message from this chat; null removes the photo' })
  @IsOptional() @IsUUID() messageId: string | null;
}
export class BabyTeachDto {
  @ApiProperty({ minLength: 1, maxLength: 20 }) @IsString() @MinLength(1) @MaxLength(20) @SanitizedText() word: string;
}
export class BabyHereDto {
  @ApiProperty({ enum: SCENES, description: 'Where you are in the baby world' }) @IsIn([...SCENES]) scene: Scene;
  @ApiPropertyOptional({ description: 'Last signal id you already have; only newer ones come back' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) since?: number;
}
export class BabySignalDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: SIGNALS }) kind: Signal;
  @ApiProperty({ format: 'uuid' }) fromId: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class BabyTogetherDto {
  @ApiProperty({ description: 'The other parent has the baby open right now' }) partnerHere: boolean;
  @ApiProperty({ type: String, nullable: true, enum: SCENES, description: 'Where the other parent is, while here' }) partnerScene: Scene | null;
  @ApiProperty({ type: () => BabySignalDto, isArray: true, description: 'Signals from the other parent newer than `since`' }) signals: BabySignalDto[];
  @ApiProperty({ description: 'Pass this as `since` next time' }) cursor: number;
}
export class BabySendSignalDto {
  @ApiProperty({ enum: SIGNALS }) @IsIn([...SIGNALS]) kind: Signal;
}
export class BabyOutfitDto {
  @ApiProperty({ minimum: 0, maximum: 5 }) @Type(() => Number) @IsInt() @Min(0) @Max(5) outfit: number;
}
export class GameRoundDto {
  @ApiProperty({ type: String, isArray: true, description: 'Choices of players[0] and players[1]' }) choices: string[];
  @ApiProperty({ type: Number, nullable: true, description: 'Index of the round winner in players; null for a tie' }) winner: number | null;
  @ApiProperty({ type: String, isArray: true, description: 'This or That: the two options of that question' }) labels: string[];
}
export class GameTurnDto {
  @ApiProperty({ description: 'Q&A: index of who asks. Truth or Dare: index of who picks and replies' }) who: number;
  @ApiProperty({ type: String, nullable: true, enum: ['truth', 'dare'] }) pick: 'truth' | 'dare' | null;
  @ApiProperty({ type: String, nullable: true, description: 'The question (Q&A) or the truth question / dare' }) question: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Q&A: "what do you mean?" from the answerer' }) clarify: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Q&A: what the asker meant' }) clarification: string | null;
  @ApiProperty({ type: String, nullable: true }) answer: string | null;
  @ApiProperty({ description: 'Truth or Dare: skipped with a pass' }) passed: boolean;
}
export class ChatGameDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: GAME_KINDS }) kind: GameKind;
  @ApiProperty({ type: String, isArray: true, format: 'uuid', description: 'players[0] starts; on boards, 1 marks players[0] and 2 players[1]' })
  players: string[];
  @ApiProperty({ type: Number, isArray: true, description: 'Board cells, row by row (XOX, Connect Four, Five in a Row)' }) board: number[];
  @ApiProperty({ type: Number, isArray: true, description: 'Winning cells once someone won a board game' }) line: number[];
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) turnId: string | null;
  @ApiProperty({ enum: ['active', 'won', 'draw', 'done'], description: '"done" ends a game nobody wins (This or That)' })
  status: 'active' | 'won' | 'draw' | 'done';
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) winnerId: string | null;
  @ApiProperty({ type: Number, isArray: true, description: 'Round wins (rock-paper-scissors) or pairs found (Memory) per player' }) scores: number[];
  @ApiProperty({ type: () => GameRoundDto, isArray: true, description: 'Finished rounds (rock-paper-scissors, This or That)' }) rounds: GameRoundDto[];
  @ApiProperty({ type: String, isArray: true, description: "Memory: each card's face while it is turned up or matched, otherwise empty" }) cards: string[];
  @ApiProperty({ type: Number, isArray: true, description: 'Memory: who found each card (0 nobody, 1 players[0], 2 players[1])' }) owners: number[];
  @ApiProperty({ type: Number, isArray: true, description: 'Memory: cards turned this turn, plus the last mismatched pair' }) flipped: number[];
  @ApiProperty({ type: String, isArray: true, description: 'This or That: the two options of the current question' }) prompt: string[];
  @ApiProperty({ description: 'This or That: current question number (0-based)' }) round: number;
  @ApiProperty({ description: 'This or That: number of questions' }) totalRounds: number;
  @ApiProperty({ type: String, nullable: true, description: "Your pick in the current rock-paper-scissors round (theirs stays hidden)" })
  myChoice: string | null;
  @ApiProperty({ description: 'The other player already picked in the current round' }) peerReady: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Q&A: ask | answer | explain. Truth or Dare: pick | prompt | reply' }) phase: string | null;
  @ApiProperty({ type: () => GameTurnDto, isArray: true, description: 'Q&A and Truth or Dare turns so far (the last one is in progress)' }) turns: GameTurnDto[];
  @ApiProperty({ type: Number, isArray: true, description: 'Q&A: "what do you mean?" left; Truth or Dare: passes left (per player)' }) chances: number[];
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}
export class StartGameDto {
  @ApiProperty({ enum: GAME_KINDS }) @IsIn([...GAME_KINDS]) kind: GameKind;
}
export class GameMoveDto {
  @ApiPropertyOptional({ description: 'Board cell (XOX, Five in a Row, Memory) or column (Connect Four)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(80) cell?: number;
  @ApiPropertyOptional({ enum: ['rock', 'paper', 'scissors', 'a', 'b', 'truth', 'dare'], description: 'Rock-paper-scissors pick, This or That answer, or truth/dare' })
  @IsOptional() @IsIn(['rock', 'paper', 'scissors', 'a', 'b', 'truth', 'dare']) choice?: 'rock' | 'paper' | 'scissors' | 'a' | 'b' | 'truth' | 'dare';
  @ApiPropertyOptional({ enum: ['ask', 'answer', 'clarify', 'explain', 'pick', 'prompt', 'reply', 'pass'], description: 'Q&A and Truth or Dare moves' })
  @IsOptional() @IsIn(['ask', 'answer', 'clarify', 'explain', 'pick', 'prompt', 'reply', 'pass'])
  action?: 'ask' | 'answer' | 'clarify' | 'explain' | 'pick' | 'prompt' | 'reply' | 'pass';
  @ApiPropertyOptional({ maxLength: 300, description: 'Written move: a question, answer, dare or explanation' })
  @IsOptional() @IsString() @MaxLength(300) @SanitizedText({ multiline: true }) text?: string;
}
export class ChatPrefsResultDto {
  @ApiProperty({ type: String, nullable: true }) nickname: string | null;
  @ApiProperty({ type: String, nullable: true }) wallpaperUrl: string | null;
}
export class ChatPrefsDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 40, description: 'Private nickname for them; null or empty clears it' })
  @IsOptional() @IsString() @MaxLength(40) @SanitizedText() nickname?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', description: 'Uploaded image to use as your wallpaper; null removes it' })
  @IsOptional() @IsUUID() wallpaperMediaId?: string | null;
}
export class MessageReactionDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() emoji: string;
}
export class ReactDto {
  @ApiProperty({ maxLength: 16, example: '❤️' }) @IsString() @MinLength(1) @MaxLength(16)
  @Matches(/^(?=.*\p{Extended_Pictographic})(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️)+$/u, { message: 'Choose an emoji' }) emoji: string;
}
export class TogetherDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'First message between you' }) since: string | null;
  @ApiProperty() messages: number;
  @ApiProperty() photos: number;
  @ApiProperty() voiceNotes: number;
  @ApiProperty() callMinutes: number;
  @ApiProperty({ description: 'UTC days on which both of you messaged' }) daysTogether: number;
}
export class SharedMediaQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: ['media', 'links'], default: 'media' })
  @IsOptional() @IsIn(['media', 'links']) kind?: 'media' | 'links';
}
export class EditMessageDto {
  @ApiProperty({maxLength:2000}) @IsString() @MinLength(1) @MaxLength(2000)
  @SanitizedText({multiline:true}) content:string;
}
export class MessagePeerDto extends UserSummaryDto {
  @ApiProperty() isUnavailable: boolean;
  @ApiProperty() isBlocking: boolean;
  @ApiProperty() isFollowing: boolean;
}
export class MessageDeliveryDto {
  @ApiProperty({type:String,isArray:true,format:'uuid'})
  @IsArray() @ArrayMaxSize(100) @IsUUID('all',{each:true}) messageIds: string[];
  @ApiPropertyOptional({type:String,isArray:true,format:'uuid',description:'Group messages received by this device; membership is checked again on acknowledgment'})
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all',{each:true}) groupMessageIds?: string[];
}
export class MessageAudioDto {
  @ApiProperty({format:'uuid'}) id: string;
  @ApiProperty() url: string;
  @ApiProperty() durationMs: number;
}
export class MessageAudioUploadDto {
  @ApiProperty({type:'string',format:'binary',description:'Recorded audio, up to two minutes / 10 MB'}) file: unknown;
}
export class ChatThemeDto {
  @ApiProperty({ enum: CHAT_THEMES }) @IsIn([...CHAT_THEMES]) theme: ChatTheme;
}
export class MessageStatusDto {
  @ApiProperty({ type: String, nullable: true, enum: CHAT_THEMES, description: 'Chat theme shared by both people; null is the default look' })
  theme: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Your private nickname for them' }) nickname: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Your wallpaper for this chat (only you see it)' }) wallpaperUrl: string | null;
  @ApiProperty({description:'Conversation history is available, but contact is unavailable'}) isUnavailable: boolean;
  @ApiProperty({description:'The viewer can unblock this account'}) isBlocking: boolean;
  @ApiProperty({
    description: 'They sent you a message request you have not accepted',
  })
  isRequest: boolean;
  @ApiProperty({
    description:
      'You sent them a message request; you can write again once they accept',
  })
  awaitingAcceptance: boolean;
  @ApiProperty({ description: 'You can send a message right now' })
  canSend: boolean;
  @ApiProperty({ description: 'They are typing to you right now' })
  peerTyping: boolean;
  @ApiProperty({ description: 'They have the app open right now' })
  peerOnline: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  peerLastActiveAt: string | null;
}
export class ConversationDto {
  @ApiProperty() isUnavailable: boolean;
  @ApiProperty({description:'Visible streak badge from three mutual days; zero if inactive'}) streakDays: number;
  @ApiProperty() streakFading: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Your private nickname for them' }) nickname: string | null;
  @ApiProperty({ type: UserSummaryDto }) user: UserSummaryDto;
  @ApiProperty({ type: DirectMessageDto }) lastMessage: DirectMessageDto;
  @ApiProperty() unreadCount: number;
  @ApiProperty({
    description:
      'Message request: you do not follow this user and have never replied',
  })
  isRequest: boolean;
  @ApiProperty({ description: 'They have the app open right now' }) online: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastActiveAt: string | null;
}
export class ConversationQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({
    enum: ['primary', 'requests'],
    description: 'Only primary conversations or only message requests',
  })
  @IsOptional()
  @IsIn(['primary', 'requests'])
  folder?: 'primary' | 'requests';
}
export class CreateStoryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Uploaded photo or video. Required unless postId is set',
  })
  @IsOptional()
  @IsUUID('all')
  mediaId?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Share an existing Reel/video post to your story',
  })
  @IsOptional()
  @IsUUID('all')
  postId?: string;
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @SanitizedText({ multiline: true })
  caption?: string;
}
export class StoryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: UserSummaryDto }) author: UserSummaryDto;
  @ApiProperty({
    type: MediaDto,
    description: 'The uploaded media, or the shared post video',
  })
  media: MediaDto;
  @ApiProperty({
    type: PostDto,
    nullable: true,
    description: 'The shared Reel/video post, if any',
  })
  post: PostDto | null;
  @ApiProperty({ type: String, nullable: true }) caption: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
  @ApiProperty() isViewed: boolean;
  @ApiProperty() isLiked: boolean;
  @ApiProperty({ description: 'Only populated for the author' })
  viewCount: number;
  @ApiProperty({ description: 'Only populated for the author' })
  likeCount: number;
}
export class StoryViewerDto {
  @ApiProperty({ type: UserSummaryDto }) user: UserSummaryDto;
  @ApiProperty({ format: 'date-time' }) viewedAt: string;
  @ApiProperty() liked: boolean;
}
export class StoryReplyDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @SanitizedText({ multiline: true })
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}
export class StickerDto {
  @ApiProperty() isFavorite: boolean;
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Built-in emoji sticker',
  })
  emoji: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Signed image URL of a custom sticker',
  })
  url: string | null;
  @ApiProperty({ description: 'Created by the viewer (can be deleted)' })
  isOwn: boolean;
}
export class CreateStickerDto {
  @ApiProperty({ format: 'uuid', description: 'An uploaded photo' })
  @IsUUID('all')
  mediaId: string;
  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @SanitizedText()
  @MaxLength(40)
  name?: string;
}

export class NoteDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: UserSummaryDto }) author: UserSummaryDto;
  @ApiProperty({ description: 'Up to 60 characters; may be empty when a song is shared' })
  text: string;
  @ApiProperty({ type: String, nullable: true }) songTitle: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Signed URL of the 15 s song clip' })
  audioUrl: string | null;
  @ApiProperty({ type: Number, nullable: true }) audioDurationMs: number | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
  @ApiProperty() isOwn: boolean;
}
export class CreateNoteDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @SanitizedText()
  @MaxLength(60)
  text?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'From POST /notes/audio' })
  @IsOptional()
  @IsUUID('all')
  audioId?: string;
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @SanitizedText()
  @MaxLength(80)
  songTitle?: string;
}
/** Multipart fields of POST /notes/audio (validated). */
export class NoteAudioFieldsDto {
  @ApiProperty({ minimum: 0, description: 'Where the 15 second clip starts, in milliseconds' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(36_000_000)
  startMs: number;
}
/** OpenAPI shape of POST /notes/audio: the file plus the validated fields. */
export class NoteAudioUploadDto extends NoteAudioFieldsDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'An audio file (MP3, M4A, WAV, OGG...)' })
  file: unknown;
}
export class NoteAudioDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ description: 'Signed URL of the clip, for previewing' }) url: string;
  @ApiProperty() durationMs: number;
}

export class PushSubscriptionDto {
  @ApiProperty({ description: 'PushSubscription.endpoint (https)' })
  @IsString()
  @MaxLength(2048)
  endpoint: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(512) p256dh?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(512) auth?: string;
}
export class PushUnsubscribeDto {
  @ApiProperty() @IsString() @MaxLength(2048) endpoint: string;
}
export class PushKeyDto {
  @ApiProperty({ description: 'VAPID public key (applicationServerKey), base64url' }) publicKey: string;
}
export class PushTestDto {
  @ApiProperty({ description: 'Devices that accepted the test notification' }) delivered: number;
}
