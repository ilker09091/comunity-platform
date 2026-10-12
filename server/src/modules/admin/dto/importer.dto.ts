import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
export class ImporterRequestDto {
  @ApiProperty({enum:['GET','POST']}) @IsIn(['GET','POST']) method:'GET'|'POST';
  @ApiProperty({description:'Allowlisted importer path, e.g. videos?mode=profile&account=@creator or automation/state',maxLength:2048}) @IsString() @MaxLength(2048) path:string;
  @ApiPropertyOptional({type:Object,additionalProperties:true,description:'Action payload validated by the existing worker; never include Circle tokens or database credentials.'}) @IsOptional() @IsObject() data?:Record<string,unknown>;
}
export class ImporterReplyDto {
  @ApiProperty({type:Object,additionalProperties:true,description:'Existing importer response: actual video pages, durable queue/schedule state, browser login frame or sanitized configuration.'}) result:Record<string,unknown>;
}
