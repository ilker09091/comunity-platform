import { Type as NestType } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ErrorCode } from '../errors/app.exception.js';

export class ErrorDetailDto {
  @ApiPropertyOptional({ example: 'email', description: 'Offending field (dot-notation for nested fields)' })
  field?: string;

  @ApiProperty({ example: 'email must be an email' })
  message: string;
}

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ enum: Object.values(ErrorCode), enumName: 'ErrorCode', example: ErrorCode.VALIDATION_ERROR })
  code: ErrorCode;

  @ApiProperty({ example: 'Validation failed' })
  message: string;

  @ApiProperty({ type: ErrorDetailDto, isArray: true })
  details: ErrorDetailDto[];
}

export class CursorQueryDto {
  @ApiPropertyOptional({
    description: 'Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page.',
    example: 'eyJ2IjpbIjIwMjYtMTAtMTFUMTI6MDA6MDAuMDAwWiIsIjNmYTg1ZjY0LTU3MTctNDU2Mi1iM2ZjLTJjOTYzZjY2YWZhNiJdfQ',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20, example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

const paginatedCache = new Map<NestType<unknown>, NestType<Page<unknown>>>();

/** Creates (once per item type) a named OpenAPI schema `Paginated<Item>` with `{items, nextCursor, hasMore}`. */
export function Paginated<T>(item: NestType<T>): NestType<Page<T>> {
  const cached = paginatedCache.get(item);
  if (cached) return cached as NestType<Page<T>>;

  class PaginatedDto implements Page<T> {
    @ApiProperty({ type: item, isArray: true })
    items: T[];

    @ApiProperty({
      type: String,
      nullable: true,
      example: null,
      description: 'Pass as `cursor` to fetch the next page. `null` when there are no more items.',
    })
    nextCursor: string | null;

    @ApiProperty({ example: false })
    hasMore: boolean;
  }
  Object.defineProperty(PaginatedDto, 'name', { value: `Paginated${item.name.replace(/Dto$/, '')}` });
  paginatedCache.set(item, PaginatedDto as NestType<Page<unknown>>);
  return PaginatedDto;
}

export class CountDto {
  @ApiProperty({ example: 3 })
  count: number;
}
