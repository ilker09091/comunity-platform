import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthUser } from '../../common/decorators/auth.decorators.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import { CallActionDto, CallConfigDto, CallDeviceDto, CallDto, CallQueryDto, CallSignalInputDto, CallStateDto, CurrentCallDto, StartCallDto, StreakDto } from './calls.dto.js';
import { CallsService } from './calls.service.js';
import { StreaksService } from './streaks.service.js';

@ApiTags('Calls') @ApiAuth() @ApiErrors(400,401,403,404,409)
@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}
  @Get('config') @ApiOperation({operationId:'callsConfig',summary:'ICE servers with short-lived TURN credentials'}) @ApiOkResponse({type:CallConfigDto})
  config(@CurrentUser() u: AuthUser) { return this.calls.config(u.id); }
  @Get('current') @ApiOperation({operationId:'callsCurrent',summary:'Incoming or ongoing call for this account'}) @ApiOkResponse({type:CurrentCallDto})
  current(@CurrentUser() u: AuthUser,@Query() q: CallDeviceDto) { return this.calls.current(u.id,q.deviceId); }
  @Post() @Throttle({default:{limit:10,ttl:60000}}) @ApiOperation({operationId:'callsStart',summary:'Start an audio or video call in an accepted conversation'}) @ApiCreatedResponse({type:CallDto})
  start(@CurrentUser() u: AuthUser,@Body() dto: StartCallDto) { return this.calls.start(u.id,dto); }
  @Get(':id') @ApiOperation({operationId:'callsPoll',summary:'Heartbeat and ordered signaling for call participants'}) @ApiOkResponse({type:CallStateDto})
  poll(@CurrentUser() u: AuthUser,@Param('id',ParseUUIDPipe) id: string,@Query() q: CallQueryDto) { return this.calls.poll(u.id,id,q); }
  @Post(':id/action') @HttpCode(200) @ApiOperation({operationId:'callsAction',summary:'Accept, decline or hang up a call'}) @ApiOkResponse({type:CallDto})
  action(@CurrentUser() u: AuthUser,@Param('id',ParseUUIDPipe) id: string,@Body() dto: CallActionDto) { return this.calls.action(u.id,id,dto); }
  @Post(':id/signals') @HttpCode(204) @Throttle({default:{limit:240,ttl:60000}}) @ApiOperation({operationId:'callsSignal',summary:'Send WebRTC SDP or ICE to the other participant'}) @ApiNoContentResponse()
  async signal(@CurrentUser() u: AuthUser,@Param('id',ParseUUIDPipe) id: string,@Body() dto: CallSignalInputDto) { await this.calls.signal(u.id,id,dto); }
}
@ApiTags('Messages') @ApiAuth() @ApiErrors(400,401,403,404,409) @Controller('messages')
export class StreaksController {
  constructor(private readonly streaks: StreaksService) {}
  @Get(':id/streak') @ApiOperation({operationId:'messagesStreak',summary:'Mutual daily messaging streak (UTC days)'}) @ApiOkResponse({type:StreakDto})
  get(@CurrentUser() u: AuthUser,@Param('id',ParseUUIDPipe) id: string) { return this.streaks.get(u.id,id); }
  @Post(':id/streak/restore') @HttpCode(200) @Throttle({default:{limit:5,ttl:60000}}) @ApiOperation({operationId:'messagesRestoreStreak',summary:'Restore within 48 hours of expiry, up to three times per pair per UTC month'}) @ApiOkResponse({type:StreakDto})
  restore(@CurrentUser() u: AuthUser,@Param('id',ParseUUIDPipe) id: string) { return this.streaks.restore(u.id,id); }
}
