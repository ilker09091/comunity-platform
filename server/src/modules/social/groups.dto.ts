import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, ArrayMaxSize, ArrayMinSize, ArrayUnique, IsString, IsUUID, MaxLength, MinLength, IsBoolean, IsOptional, IsIn, ValidateIf } from 'class-validator';
import { SanitizedText } from '../../common/utils/sanitize.js';
import { UserSummaryDto } from '../users/dto/user.dto.js';
import { DirectMessageDto } from './social.dto.js';

export const GROUP_ROLES = ['owner', 'admin', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];
export const GROUP_EVENTS = ['created', 'added', 'removed', 'left', 'joined', 'renamed', 'photo', 'description', 'pinned', 'unpinned', 'admin', 'unadmin', 'owner'] as const;
export type GroupEventType = (typeof GROUP_EVENTS)[number];

export class GroupDto {
  @ApiProperty({format:'uuid'}) id:string;
  @ApiProperty() name:string;
  @ApiProperty({type:String,nullable:true}) avatarUrl:string|null;
  @ApiProperty({format:'uuid'}) ownerId:string;
  @ApiProperty() memberCount:number;
  @ApiProperty() unreadCount:number;
  @ApiProperty({type:String,nullable:true}) lastMessage:string|null;
  @ApiProperty({type:String,nullable:true,description:'First name of whoever sent the last message; null for your own or a system event'}) lastSenderName:string|null;
  @ApiProperty() muted:boolean;
  @ApiProperty({format:'date-time'}) updatedAt:string;
}
export class GroupMemberDto extends UserSummaryDto {
  @ApiProperty({enum:GROUP_ROLES}) role:GroupRole;
  @ApiProperty({format:'date-time'}) joinedAt:string;
}
export class GroupPinnedDto {
  @ApiProperty({format:'uuid'}) id:string;
  @ApiProperty() senderName:string;
  @ApiProperty() preview:string;
}
export class GroupDetailDto extends GroupDto {
  @ApiProperty({type:[GroupMemberDto]}) members:GroupMemberDto[];
  @ApiProperty({type:String,nullable:true}) description:string|null;
  @ApiProperty({enum:GROUP_ROLES}) myRole:GroupRole;
  @ApiProperty({description:'Everyone (not only admins) may add people'}) membersCanAdd:boolean;
  @ApiProperty({description:'Everyone (not only admins) may change the name, photo, description and pin'}) membersCanEdit:boolean;
  @ApiProperty({type:GroupPinnedDto,nullable:true}) pinned:GroupPinnedDto|null;
  @ApiProperty({format:'date-time'}) createdAt:string;
}
export class GroupEventDto {
  @ApiProperty({enum:GROUP_EVENTS}) type:GroupEventType;
  @ApiProperty({type:[String],description:'Names of the people it was about (added, removed, made admin)'}) targets:string[];
  @ApiProperty({type:String,nullable:true,description:'The new name or description, or the pinned text'}) value:string|null;
}
export class GroupMessageDto extends DirectMessageDto {
  @ApiProperty({type:UserSummaryDto}) sender:UserSummaryDto;
  @ApiProperty({type:GroupEventDto,nullable:true,description:'Set on system messages; the sender is who did it'}) event:GroupEventDto|null;
}
export class GroupReceiptDto {
  @ApiProperty({type:UserSummaryDto}) user:UserSummaryDto;
  @ApiProperty({type:String,nullable:true,format:'date-time'}) at:string|null;
}
export class GroupReceiptsDto {
  @ApiProperty({type:[GroupReceiptDto]}) readBy:GroupReceiptDto[];
  @ApiProperty({type:[GroupReceiptDto],description:'Got it but has not read it yet'}) deliveredTo:GroupReceiptDto[];
  @ApiProperty({type:[UserSummaryDto],description:'Has not received it yet'}) waiting:UserSummaryDto[];
}
export class GroupMediaDto {
  @ApiProperty({format:'uuid'}) messageId:string;
  @ApiProperty({enum:['IMAGE','VIDEO']}) type:'IMAGE'|'VIDEO';
  @ApiProperty() url:string;
  @ApiProperty({format:'date-time'}) createdAt:string;
}
export class GroupMediaListDto {
  @ApiProperty({type:[GroupMediaDto]}) items:GroupMediaDto[];
}
export class GroupMembersDto {
  @ApiProperty({type:[String],format:'uuid',maxItems:31}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(31) @ArrayUnique() @IsUUID('all',{each:true}) memberIds:string[];
}
export class CreateGroupDto extends GroupMembersDto {
  @ApiProperty({maxLength:60}) @IsString() @MinLength(1) @MaxLength(60) @SanitizedText() name:string;
  @ApiPropertyOptional({maxLength:255}) @IsOptional() @IsString() @MaxLength(255) @SanitizedText() description?:string;
  @ApiPropertyOptional({format:'uuid',description:'An uploaded photo for the group'}) @IsOptional() @IsUUID('all') avatarMediaId?:string;
}
export class UpdateGroupDto {
  @ApiPropertyOptional({maxLength:60}) @IsOptional() @IsString() @MinLength(1) @MaxLength(60) @SanitizedText() name?:string;
  @ApiPropertyOptional({maxLength:255,description:'Empty removes it'}) @IsOptional() @IsString() @MaxLength(255) @SanitizedText() description?:string;
}
export class GroupPermissionsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() membersCanAdd?:boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() membersCanEdit?:boolean;
}
export class GroupRoleDto {
  @ApiProperty({enum:['admin','member','owner'],description:'owner hands the group over (you become an admin)'}) @IsIn(['admin','member','owner']) role:'admin'|'member'|'owner';
}
export class GroupPinDto {
  @ApiProperty({type:String,format:'uuid',nullable:true,description:'null unpins'}) @ValidateIf((_,v)=>v!==null) @IsUUID('all') messageId:string|null;
}
export class GroupMuteDto {
  @ApiProperty() @IsBoolean() muted:boolean;
}
export class GroupAckDto {
  @ApiProperty({format:'uuid'}) @IsUUID('all') messageId:string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() read?:boolean;
}
export class GroupAvatarDto {
  @ApiProperty({format:'uuid'}) @IsUUID('all') mediaId:string;
}
