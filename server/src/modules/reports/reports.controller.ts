import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { Paginated } from '../../common/dto/common.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import {
  CreateReportDto,
  ModerationReportDto,
  ModerationReportsQueryDto,
  ModerationResultDto,
  ReportDto,
  ResolveReportDto,
  SetRoleDto,
} from './dto/report.dto.js';
import { ReportsService } from './reports.service.js';
import { ReqContext, type RequestContext } from '../platform/audit.service.js';

@ApiTags('Reports')
@ApiAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiOperation({ summary: 'Report a post, comment or account' })
  @ApiCreatedResponse({ type: ReportDto })
  @ApiErrors(400, 404, 409)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto): Promise<ReportDto> {
    return this.reports.create(user.id, dto);
  }
}

@ApiTags('Moderation')
@ApiAuth()
@ApiErrors(403)
@Roles('MODERATOR', 'ADMIN')
@Controller('moderation')
export class ModerationController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports')
  @ApiOperation({ summary: 'Moderation queue (MODERATOR/ADMIN)', description: 'Defaults to OPEN reports, newest first.' })
  @ApiOkResponse({ type: Paginated(ModerationReportDto) })
  @ApiErrors(400)
  list(@Query() q: ModerationReportsQueryDto): Promise<Page<ModerationReportDto>> {
    return this.reports.listForModeration({ status: q.status, targetType: q.targetType }, q.cursor, q.limit ?? 20);
  }

  @Patch('reports/:id')
  @ApiOperation({ summary: 'Resolve or dismiss a report, optionally acting on the target (MODERATOR/ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ModerationReportDto })
  @ApiErrors(400, 404)
  resolve(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: ResolveReportDto): Promise<ModerationReportDto> {
    return this.reports.resolve(ctx, id, dto);
  }

  @Post('posts/:id/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide a post from everyone (MODERATOR/ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ModerationResultDto })
  @ApiErrors(400, 404)
  removePost(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string): Promise<ModerationResultDto> {
    return this.reports.moderateContent(ctx, 'posts', id, 'REMOVED');
  }

  @Post('posts/:id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a removed post (MODERATOR/ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ModerationResultDto })
  @ApiErrors(400, 404)
  restorePost(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string): Promise<ModerationResultDto> {
    return this.reports.moderateContent(ctx, 'posts', id, 'ACTIVE');
  }

  @Post('comments/:id/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide a comment (shown as REMOVED tombstone) (MODERATOR/ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ModerationResultDto })
  @ApiErrors(400, 404)
  removeComment(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string): Promise<ModerationResultDto> {
    return this.reports.moderateContent(ctx, 'comments', id, 'REMOVED');
  }

  @Post('comments/:id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a removed comment (MODERATOR/ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ModerationResultDto })
  @ApiErrors(400, 404)
  restoreComment(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string): Promise<ModerationResultDto> {
    return this.reports.moderateContent(ctx, 'comments', id, 'ACTIVE');
  }

  @Post('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Suspend an account and revoke its sessions (ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ModerationResultDto })
  @ApiErrors(400, 404)
  suspend(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string): Promise<ModerationResultDto> {
    return this.reports.changeUserStatus(ctx, id, 'SUSPENDED');
  }

  @Post('users/:id/unsuspend')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Reactivate a suspended account (ADMIN)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ModerationResultDto })
  @ApiErrors(400, 404)
  unsuspend(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string): Promise<ModerationResultDto> {
    return this.reports.changeUserStatus(ctx, id, 'ACTIVE');
  }

  @Patch('users/:id/role')
  @Roles('ADMIN')
  @ApiOperation({ summary: "Change a user's role (ADMIN)" })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ModerationResultDto })
  @ApiErrors(400, 404)
  setRole(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: SetRoleDto): Promise<ModerationResultDto> {
    return this.reports.setRole(ctx, id, dto.role);
  }
}
