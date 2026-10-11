import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiErrors } from '../../../common/swagger/api-docs.decorators.js';
import { ReqContext, type RequestContext } from '../../platform/audit.service.js';
import { StepUpService } from '../../platform/step-up.service.js';
import { AdminAnalyticsService } from '../admin-analytics.service.js';
import { AdminController, RequirePermissions } from '../admin.guard.js';
import { AdminUsersService } from '../admin-users.service.js';
import {
  AdminMeDto,
  DashboardDto,
  OverviewDto,
  StepUpRequestDto,
  StepUpResponseDto,
  TimeseriesQueryDto,
  TimeseriesResponseDto,
  TopContentQueryDto,
  TopContentResponseDto,
} from '../dto/admin.dto.js';

@ApiTags('Admin · Core')
@AdminController()
@Controller('admin')
export class AdminCoreController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly stepUp: StepUpService,
    private readonly analytics: AdminAnalyticsService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Current staff member: role, permissions and grantable roles', description: 'Any staff role. Ordinary users get 403.' })
  @ApiOkResponse({ type: AdminMeDto })
  me(@ReqContext() ctx: RequestContext): Promise<AdminMeDto> {
    return this.users.me(ctx);
  }

  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Confirm password for sensitive operations',
    description:
      'Returns a 10-minute token bound to this session. Send it as `X-Step-Up-Token` for: ban/unban, role changes, ' +
      'settings updates, publishing announcements and media cleanup (otherwise 403 `STEP_UP_REQUIRED`). ' +
      'A wrong password returns 403 `INVALID_CREDENTIALS` (not 401, so clients keep the session).',
  })
  @ApiOkResponse({ type: StepUpResponseDto })
  @ApiErrors(400)
  stepUpToken(@ReqContext() ctx: RequestContext, @Body() dto: StepUpRequestDto): Promise<StepUpResponseDto> {
    return this.stepUp.issue(ctx, dto.password);
  }

  @Get('dashboard')
  @RequirePermissions('users.read')
  @ApiOperation({
    summary: 'Dashboard: counters, recent activity and alerts',
    description: 'Sections the viewer lacks permission for (reports, audit, system alerts) are returned empty.',
  })
  @ApiOkResponse({ type: DashboardDto })
  dashboard(@ReqContext() ctx: RequestContext): Promise<DashboardDto> {
    return this.analytics.dashboard(ctx);
  }
}

@ApiTags('Admin · Analytics')
@AdminController()
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('overview')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Platform counters (exact counts, cached ≤30 s)' })
  @ApiOkResponse({ type: OverviewDto })
  overview(): Promise<OverviewDto> {
    return this.analytics.overview();
  }

  @Get('timeseries')
  @RequirePermissions('analytics.read')
  @ApiOperation({
    summary: 'Time series for one or more metrics (UTC buckets)',
    description: 'Max 400 daily, 260 weekly or 120 monthly buckets. `active_users` only exists since activity tracking began.',
  })
  @ApiOkResponse({ type: TimeseriesResponseDto })
  @ApiErrors(400)
  timeseries(@Query() q: TimeseriesQueryDto): Promise<TimeseriesResponseDto> {
    return this.analytics.timeseries(q);
  }

  @Get('top-content')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Most engaged posts or Reels created in a range' })
  @ApiOkResponse({ type: TopContentResponseDto })
  @ApiErrors(400)
  top(@Query() q: TopContentQueryDto): Promise<TopContentResponseDto> {
    return this.analytics.topContent(q);
  }
}
