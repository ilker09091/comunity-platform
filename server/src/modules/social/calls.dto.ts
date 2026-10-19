import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { UserSummaryDto } from '../users/dto/user.dto.js';

export class CallDeviceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() deviceId: string;
}
export class CallQueryDto extends CallDeviceDto {
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) after?: number;
}
export class StartCallDto extends CallDeviceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() peerId: string;
  @ApiProperty({ enum: ['audio', 'video'] }) @IsIn(['audio', 'video']) kind: 'audio' | 'video';
}
export class CallActionDto extends CallDeviceDto {
  @ApiProperty({ enum: ['accept', 'reject', 'end'] }) @IsIn(['accept', 'reject', 'end']) action: 'accept' | 'reject' | 'end';
}
export class CallSignalInputDto extends CallDeviceDto {
  @ApiProperty({ enum: ['description', 'ice'] }) @IsIn(['description', 'ice']) kind: 'description' | 'ice';
  @ApiProperty({ maxLength: 64000, description: 'JSON RTCSessionDescriptionInit or RTCIceCandidateInit' }) @IsString() @MaxLength(64000) payload: string;
}
export class CallDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['audio','video'] }) kind: 'audio' | 'video';
  @ApiProperty({ enum: ['ringing','accepted','ended'] }) state: 'ringing' | 'accepted' | 'ended';
  @ApiProperty() outgoing: boolean;
  @ApiProperty() canControl: boolean;
  @ApiProperty({ type: UserSummaryDto }) peer: UserSummaryDto;
  @ApiProperty() createdAt: string;
  @ApiProperty({ type: String, nullable: true }) acceptedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) endReason: string | null;
}
export class CurrentCallDto {
  @ApiProperty({ type: CallDto, nullable: true }) call: CallDto | null;
}
export class CallSignalDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ['description','ice'] }) kind: 'description' | 'ice';
  @ApiProperty() payload: string;
}
export class CallStateDto {
  @ApiProperty({ type: CallDto }) call: CallDto;
  @ApiProperty({ type: [CallSignalDto] }) signals: CallSignalDto[];
  @ApiProperty() cursor: number;
}
export class IceServerDto {
  @ApiProperty({ type: [String] }) urls: string[];
  @ApiPropertyOptional() username?: string;
  @ApiPropertyOptional() credential?: string;
}
export class CallConfigDto {
  @ApiProperty({ type: [IceServerDto] }) iceServers: IceServerDto[];
  @ApiProperty() relayConfigured: boolean;
}
export class StreakDto {
  @ApiProperty() days: number;
  @ApiProperty({ enum: ['building','active','fading','expired'] }) state: 'building' | 'active' | 'fading' | 'expired';
  @ApiProperty() sentToday: boolean;
  @ApiProperty() peerSentToday: boolean;
  @ApiProperty() canRestore: boolean;
  @ApiProperty() restoresRemaining: number;
  @ApiProperty({ type: String, nullable: true }) expiresAt: string | null;
}
