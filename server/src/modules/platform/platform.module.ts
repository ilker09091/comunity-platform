import { Controller, Get, Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators.js';
import { ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import { AccountGovernanceService } from './account-governance.service.js';
import { AuditService } from './audit.service.js';
import { ContentModerationService } from './content-moderation.service.js';
import { PublicPlatformConfigDto } from './dto/settings.dto.js';
import { JobRegistryService } from './job-registry.service.js';
import { MaintenanceGuard } from './maintenance.guard.js';
import { PlatformSettingsService } from './platform-settings.service.js';
import { StepUpService } from './step-up.service.js';

@ApiTags('Platform')
@Controller('platform')
export class PlatformController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Public()
  @Get('config')
  @ApiOperation({
    summary: 'Public runtime configuration',
    description:
      'Feature flags, content limits and maintenance state set by administrators. Clients should hide disabled features; ' +
      'the API enforces every flag regardless (403 `FEATURE_DISABLED`, 503 `READ_ONLY_MODE`). Cached server-side for up to 15 s.',
  })
  @ApiOkResponse({ type: PublicPlatformConfigDto })
  @ApiErrors()
  config(): Promise<PublicPlatformConfigDto> {
    return this.settings.publicConfig();
  }
}

/** Cross-cutting platform services: runtime settings, audit log, job status. */
const SERVICES = [
  PlatformSettingsService,
  AuditService,
  JobRegistryService,
  MaintenanceGuard,
  StepUpService,
  AccountGovernanceService,
  ContentModerationService,
];

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [PlatformController],
  providers: SERVICES,
  exports: SERVICES,
})
export class PlatformModule {}
