import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MediaTypeEnum {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

export enum MediaStatusEnum {
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export class MediaDto {
  @ApiProperty({ format: 'uuid', example: '0b6f3c9e-2c1f-4f43-9d0e-6f1d5b2f8a11' })
  id: string;

  @ApiProperty({ enum: MediaTypeEnum, enumName: 'MediaType', example: MediaTypeEnum.IMAGE })
  type: MediaTypeEnum;

  @ApiProperty({ enum: MediaStatusEnum, enumName: 'MediaStatus', example: MediaStatusEnum.READY })
  status: MediaStatusEnum;

  @ApiProperty({
    description: 'Signed, expiring URL. Do not persist; refetch the parent resource for a fresh URL.',
    example: 'http://localhost:3002/api/media/files/9f2c4e0d1a7b4c3e8f6a5b2d1c0e9f8a.webp?exp=1760227200&sig=Qk3…',
  })
  url: string;

  @ApiProperty({ example: 'image/webp' })
  mimeType: string;

  @ApiProperty({ example: 245760 })
  sizeBytes: number;

  @ApiProperty({ type: Number, nullable: true, example: 1080 })
  width: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1350 })
  height: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null, description: 'Video duration (null when unknown)' })
  durationMs: number | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-11T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'Videos only: compression progress 0–100 while `status` is PROCESSING (null otherwise or when unknown)',
  })
  processingProgress: number | null;
}

export class UploadMediaDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Image (jpeg, png, webp, gif) or a video in any common format (mp4, mov, webm, mkv, avi, 3gp, …). ' +
      'Type is verified from file contents. Videos are compressed to MP4 in the background.',
  })
  file: unknown;
}

/** Multipart fields of POST /media/{id}/soundtrack (validated). */
export class SoundtrackFieldsDto {
  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Keep the original sound under the music' })
  @IsOptional()
  @IsIn(['true', 'false'])
  mix?: 'true' | 'false';
}
/** OpenAPI shape of POST /media/{id}/soundtrack. */
export class SoundtrackUploadDto extends SoundtrackFieldsDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'The music clip (audio file, up to 90 s)' })
  file: unknown;
}
