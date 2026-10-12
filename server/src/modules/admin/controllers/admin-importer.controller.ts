import { Body,Controller,Post,HttpCode,Req } from '@nestjs/common';
import { ApiOkResponse,ApiOperation,ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ReqContext,type RequestContext } from '../../platform/audit.service.js';
import { AdminController,RequirePermissions } from '../admin.guard.js';
import { AdminImporterService } from '../admin-importer.service.js';
import { ImporterRequestDto,ImporterReplyDto } from '../dto/importer.dto.js';
@ApiTags('Admin · Fiktok Importer') @AdminController() @Controller('admin/importer')
export class AdminImporterController {
  constructor(private readonly importer:AdminImporterService) {}
  @Post('request') @HttpCode(200) @RequirePermissions('media.manage','settings.update')
  @Throttle({default:{limit:180,ttl:60000}})
  @ApiOperation({summary:'Operate the persistent Fiktok importer through the current admin session',description:'Allowlisted worker operations only. Database/storage settings come from Circle automatically; credentials never reach the browser. Import queues and schedules keep running after the panel closes. Requires ADMIN or SUPER_ADMIN. Source-account login happens in the isolated remote browser; no invented scraping endpoint or fake video results.'})
  @ApiOkResponse({type:ImporterReplyDto})
  request(@ReqContext() ctx:RequestContext,@Req() req:Request,@Body() dto:ImporterRequestDto):Promise<ImporterReplyDto> {
    return this.importer.request(ctx,req.headers.authorization!.replace(/^Bearer\s+/i,''),dto);
  }
}
