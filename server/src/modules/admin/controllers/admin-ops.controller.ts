import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UuidPipe } from '../../../common/errors/validation.js';
import { ApiErrors } from '../../../common/swagger/api-docs.decorators.js';
import { ReqContext, type RequestContext } from '../../platform/audit.service.js';
import { AdminSettingsResponseDto, UpdatePlatformSettingsDto } from '../../platform/dto/settings.dto.js';
import { PlatformSettingsService } from '../../platform/platform-settings.service.js';
import { StepUpService } from '../../platform/step-up.service.js';
import { AdminAnnouncementsService } from '../admin-announcements.service.js';
import { AdminController, ApiStepUp, RequirePermissions } from '../admin.guard.js';
import { AdminMediaService } from '../admin-media.service.js';
import { AdminOpsService } from '../admin-ops.service.js';
import { AdminReportsService } from '../admin-reports.service.js';
import {
  AdminMediaQueryDto,
  AdminMediaRowDto,
  AdminPageOf,
  AdminReportDetailDto,
  AdminReportRowDto,
  AdminReportsQueryDto,
  AnnouncementDto,
  AnnouncementsQueryDto,
  AssignReportDto,
  AuditLogDto,
  AuditQueryDto,
  CleanupExecuteDto,
  CleanupPreviewDto,
  CleanupResultDto,
  CreateReportNoteDto,
  MediaHealthDto,
  MediaScanQueryDto,
  MediaScanResultDto,
  ReportActionDto,
  ReportNoteDto,
  ReportStatusChangeDto,
  RolesOverviewDto,
  SaveAnnouncementDto,
  SystemStatusDto,
  type AdminPage,
} from '../dto/admin.dto.js';

@ApiTags('Admin · Media')
@AdminController()
@Controller('admin/media')
export class AdminMediaController {
  constructor(private readonly media: AdminMediaService) {}

  @Get()
  @RequirePermissions('media.manage')
  @ApiOperation({ summary: 'Media library: images and videos with owner and usage (post, avatar, cover, unattached)' })
  @ApiOkResponse({ type: AdminPageOf(AdminMediaRowDto) })
  @ApiErrors(400)
  list(@Query() q: AdminMediaQueryDto): Promise<AdminPage<AdminMediaRowDto>> {
    return this.media.list(q);
  }

  @Get('scan')
  @RequirePermissions('media.manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Scan a page of media records against storage (read-only)',
    description: 'Reports missing objects, size mismatches and FAILED processing. Bounded per request; continue with `afterId`.',
  })
  @ApiOkResponse({ type: MediaScanResultDto })
  @ApiErrors(400)
  scan(@Query() q: MediaScanQueryDto): Promise<MediaScanResultDto> {
    return this.media.scan(q.limit ?? 50, q.afterId);
  }

  @Get('cleanup')
  @RequirePermissions('media.manage')
  @ApiOperation({ summary: 'Dry run: orphaned uploads eligible for cleanup (nothing is deleted)' })
  @ApiOkResponse({ type: CleanupPreviewDto })
  cleanupPreview(): Promise<CleanupPreviewDto> {
    return this.media.cleanupPreview();
  }

  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('media.manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Delete reviewed orphaned uploads (step-up)',
    description: 'Each id is re-verified as unattached and past the TTL; referenced media is never deleted.',
  })
  @ApiOkResponse({ type: CleanupResultDto })
  @ApiErrors(400)
  @ApiStepUp()
  cleanup(@ReqContext() ctx: RequestContext, @Body() dto: CleanupExecuteDto): Promise<CleanupResultDto> {
    return this.media.cleanupExecute(ctx, dto.mediaIds);
  }

  @Get(':id')
  @RequirePermissions('media.manage')
  @ApiOperation({ summary: 'Media detail' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminMediaRowDto })
  @ApiErrors(400, 404)
  detail(@Param('id', UuidPipe) id: string): Promise<AdminMediaRowDto> {
    return this.media.detail(id);
  }

  @Get(':id/health')
  @RequirePermissions('media.manage')
  @ApiOperation({ summary: 'Check one stored object (3 s timeout)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaHealthDto })
  @ApiErrors(400, 404)
  health(@Param('id', UuidPipe) id: string): Promise<MediaHealthDto> {
    return this.media.health(id);
  }
}

@ApiTags('Admin · Reports')
@AdminController()
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}

  @Get()
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Report queue (pending = OPEN + IN_REVIEW, oldest first by default)' })
  @ApiOkResponse({ type: AdminPageOf(AdminReportRowDto) })
  @ApiErrors(400)
  list(@ReqContext() ctx: RequestContext, @Query() q: AdminReportsQueryDto): Promise<AdminPage<AdminReportRowDto>> {
    return this.reports.list(ctx, q);
  }

  @Get(':id')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Report with full target, related reports, internal notes and history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminReportDetailDto })
  @ApiErrors(400, 404)
  detail(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string): Promise<AdminReportDetailDto> {
    return this.reports.detail(ctx, id);
  }

  @Patch(':id/assignee')
  @RequirePermissions('reports.resolve')
  @ApiOperation({ summary: 'Assign (moves OPEN → IN_REVIEW) or unassign a moderator' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminReportRowDto })
  @ApiErrors(400, 404)
  assign(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: AssignReportDto): Promise<AdminReportRowDto> {
    return this.reports.assign(ctx, id, dto.assigneeId);
  }

  @Patch(':id/status')
  @RequirePermissions('reports.resolve')
  @ApiOperation({ summary: 'Change status: OPEN ↔ IN_REVIEW → RESOLVED | DISMISSED (closed reports can be reopened)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminReportRowDto })
  @ApiErrors(400, 404, 409)
  status(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: ReportStatusChangeDto): Promise<AdminReportRowDto> {
    return this.reports.setStatus(ctx, id, dto.status, dto.note);
  }

  @Post(':id/notes')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Add an internal moderator note (never visible to users)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: ReportNoteDto })
  @ApiErrors(400, 404)
  note(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: CreateReportNoteDto): Promise<ReportNoteDto> {
    return this.reports.addNote(ctx, id, dto.body);
  }

  @Post(':id/actions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reports.resolve')
  @ApiOperation({
    summary: 'Act on the reported target, then resolve',
    description:
      'Hide/remove/restore content, warn, suspend or ban the owner. Each action applies the same permission, rank and ' +
      'step-up rules as the dedicated endpoints (BAN_USER needs step-up and `confirmUsername`).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminReportRowDto })
  @ApiErrors(400, 404, 409)
  act(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: ReportActionDto): Promise<AdminReportRowDto> {
    return this.reports.act(ctx, id, dto);
  }
}

@ApiTags('Admin · Announcements')
@AdminController()
@Controller('admin/announcements')
export class AdminAnnouncementsController {
  constructor(private readonly announcements: AdminAnnouncementsService) {}

  @Get()
  @RequirePermissions('notifications.broadcast')
  @ApiOperation({ summary: 'Announcement history with recipient and read counts' })
  @ApiOkResponse({ type: AdminPageOf(AnnouncementDto) })
  @ApiErrors(400)
  list(@Query() q: AnnouncementsQueryDto): Promise<AdminPage<AnnouncementDto>> {
    return this.announcements.list(q);
  }

  @Post()
  @RequirePermissions('notifications.broadcast')
  @ApiOperation({ summary: 'Create a draft (nothing is sent until published)' })
  @ApiCreatedResponse({ type: AnnouncementDto })
  @ApiErrors(400)
  create(@ReqContext() ctx: RequestContext, @Body() dto: SaveAnnouncementDto): Promise<AnnouncementDto> {
    return this.announcements.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermissions('notifications.broadcast')
  @ApiOperation({ summary: 'Announcement detail' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AnnouncementDto })
  @ApiErrors(400, 404)
  get(@Param('id', UuidPipe) id: string): Promise<AnnouncementDto> {
    return this.announcements.get(id);
  }

  @Put(':id')
  @RequirePermissions('notifications.broadcast')
  @ApiOperation({ summary: 'Edit a draft' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AnnouncementDto })
  @ApiErrors(400, 404, 409)
  update(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: SaveAnnouncementDto): Promise<AnnouncementDto> {
    return this.announcements.update(ctx, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notifications.broadcast')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Publish a draft to the audience’s inbox (step-up, once)',
    description: 'Publishing an announcement that is not a draft returns 409 `INVALID_STATE` (never a duplicate send).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AnnouncementDto })
  @ApiErrors(400, 404, 409)
  @ApiStepUp()
  publish(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string): Promise<AnnouncementDto> {
    return this.announcements.publish(ctx, id);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notifications.broadcast')
  @ApiOperation({ summary: 'Archive (removes it from users’ inboxes)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AnnouncementDto })
  @ApiErrors(400, 404)
  archive(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string): Promise<AnnouncementDto> {
    return this.announcements.archive(ctx, id);
  }
}

@ApiTags('Admin · Settings')
@AdminController()
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly stepUp: StepUpService,
  ) {}

  @Get()
  @RequirePermissions('settings.read')
  @ApiOperation({ summary: 'Platform settings, feature flags and server hard limits' })
  @ApiOkResponse({ type: AdminSettingsResponseDto })
  get(): Promise<AdminSettingsResponseDto> {
    return this.settings.getForAdmin();
  }

  @Patch()
  @RequirePermissions('settings.update')
  @ApiOperation({
    summary: 'Update settings sections (step-up)',
    description: 'Each provided section is replaced as a whole and validated; every changed value is audited. Takes effect within 15 s.',
  })
  @ApiOkResponse({ type: AdminSettingsResponseDto })
  @ApiErrors(400)
  @ApiStepUp()
  async update(@ReqContext() ctx: RequestContext, @Body() dto: UpdatePlatformSettingsDto): Promise<AdminSettingsResponseDto> {
    await this.stepUp.assert(ctx);
    return this.settings.update(ctx, dto);
  }
}

@ApiTags('Admin · System')
@AdminController()
@Controller('admin')
export class AdminSystemController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('roles')
  @RequirePermissions('users.roles.manage')
  @ApiOperation({ summary: 'Roles, permission matrix, staff accounts and recent role changes' })
  @ApiOkResponse({ type: RolesOverviewDto })
  roles(@ReqContext() ctx: RequestContext): Promise<RolesOverviewDto> {
    return this.ops.roles(ctx);
  }

  @Get('audit-logs')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Append-only audit log (read-only; entries cannot be edited or deleted)' })
  @ApiOkResponse({ type: AdminPageOf(AuditLogDto) })
  @ApiErrors(400)
  audit(@Query() q: AuditQueryDto): Promise<AdminPage<AuditLogDto>> {
    return this.ops.audit(q);
  }

  @Get('audit-logs/actions')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Distinct recorded action names (for filters)' })
  @ApiOkResponse({ type: [String] })
  actions(): Promise<string[]> {
    return this.ops.actions();
  }

  @Get('system')
  @RequirePermissions('system.read')
  @ApiOperation({
    summary: 'System status: API, database, storage, jobs and recent errors',
    description: 'No environment variables or secrets are exposed; CPU/RAM metrics are not collected and not shown.',
  })
  @ApiOkResponse({ type: SystemStatusDto })
  system(): Promise<SystemStatusDto> {
    return this.ops.system();
  }
}
