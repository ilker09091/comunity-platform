import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, ArrayMaxSize, ArrayMinSize, ArrayUnique, IsString, IsUUID, MaxLength, MinLength, IsBoolean, IsOptional } from 'class-validator';
import { SanitizedText } from '../../common/utils/sanitize.js';
import { UserSummaryDto } from '../users/dto/user.dto.js';
import { DirectMessageDto } from './social.dto.js';

export class GroupDto {
  @ApiProperty({format:'uuid'}) id:string;
  @ApiProperty() name:string;
  @ApiProperty({format:'uuid'}) ownerId:string;
  @ApiProperty() memberCount:number;
  @ApiProperty() unreadCount:number;
  @ApiProperty({type:String,nullable:true}) lastMessage:string|null;
  @ApiProperty({format:'date-time'}) updatedAt:string;
}
export class GroupDetailDto extends GroupDto {
  @ApiProperty({type:[UserSummaryDto]}) members:UserSummaryDto[];
}
export class GroupMessageDto extends DirectMessageDto {
  @ApiProperty({type:UserSummaryDto}) sender:UserSummaryDto;
}
export class GroupMembersDto {
  @ApiProperty({type:[String],format:'uuid',maxItems:31}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(31) @ArrayUnique() @IsUUID('all',{each:true}) memberIds:string[];
}
export class CreateGroupDto extends GroupMembersDto {
  @ApiProperty({maxLength:60}) @IsString() @MinLength(1) @MaxLength(60) @SanitizedText() name:string;
}
export class RenameGroupDto {
  @ApiProperty({maxLength:60}) @IsString() @MinLength(1) @MaxLength(60) @SanitizedText() name:string;
}
export class GroupAckDto {
  @ApiProperty({format:'uuid'}) @IsUUID('all') messageId:string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() read?:boolean;
}
