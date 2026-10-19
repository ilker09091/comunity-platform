import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UuidPipe } from '../../../common/errors/validation.js';
import { ApiErrors } from '../../../common/swagger/api-docs.decorators.js';
import { AccountGovernanceService } from '../../platform/account-governance.service.js';
import { ContentModerationService } from '../../platform/content-moderation.service.js';
import { StepUpService } from '../../platform/step-up.service.js';
import { AppException, ErrorCode } from '../../../common/errors/app.exception.js';
import { Throttle } from '@nestjs/throttler';
import { ReqContext, type RequestContext } from '../../platform/audit.service.js';
import { AdminController, ApiStepUp, RequirePermissions } from '../admin.guard.js';
import { AdminUsersService } from '../admin-users.service.js';
import { AdminDeletionService } from '../admin-deletion.service.js';
import {
  AccountStatusResultDto,
  AdminPageOf,
  AdminUserDetailDto,
  AdminUserRowDto,
  AdminUsersQueryDto,
  BanUserDto,
  BulkModerateUserContentDto,
  BulkModerationResultDto,
  DeleteUserContentDto,
  DeleteAccountDto,
  DeletionResultDto,
  ChangeRoleDto,
  ReasonDto,
  RoleResultDto,
  SetVerifiedDto,
  SuspendUserDto,
  VerifiedResultDto,
  WarningCreatedDto,
  WarnUserDto,
  type AdminPage,
} from '../dto/admin.dto.js';
import { UserStatusEnum } from '../../users/dto/user.dto.js';

const RANK_NOTE =
  'The target must have a lower role than the acting admin (403 `INSUFFICIENT_RANK`); nobody can act on their own account.';

@ApiTags('Admin · Users')
@AdminController()
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly governance: AccountGovernanceService,
    private readonly moderation: ContentModerationService,
    private readonly stepUp: StepUpService,
    private readonly deletion: AdminDeletionService,
  ) {}

  @Post(':id/delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.ban','media.manage')
  @ApiStepUp()
  @Throttle({default:{limit:5,ttl:60000}})
  @ApiOperation({operationId:'adminUsersDeleteAccount',summary:'Permanently delete an account, its database rows and uploaded media'})
  @ApiOkResponse({type:DeletionResultDto})
  @ApiErrors(400,403,404)
  deleteAccount(@ReqContext() ctx:RequestContext,@Param('id',UuidPipe) id:string,@Body() dto:DeleteAccountDto) {
    return this.deletion.deleteAccount(ctx,id,dto.reason,dto.confirmUsername);
  }

  @Post(':id/content/delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('posts.read')
  @ApiStepUp()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Permanently delete an account’s content and media (step-up + typed username)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DeletionResultDto })
  @ApiErrors(400, 403, 404)
  deleteContent(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: DeleteUserContentDto): Promise<DeletionResultDto> {
    return this.deletion.deleteUserContent(ctx, id, dto.scope, dto.reason, dto.confirmUsername);
  }

  @Get()
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Search and filter accounts', description: 'Emails are included only with `users.email.read`.' })
  @ApiOkResponse({ type: AdminPageOf(AdminUserRowDto) })
  @ApiErrors(400)
  list(@ReqContext() ctx: RequestContext, @Query() q: AdminUsersQueryDto): Promise<AdminPage<AdminUserRowDto>> {
    return this.users.list(ctx, q);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Account detail: profile, activity, relationships, restrictions, warnings, reports and history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminUserDetailDto })
  @ApiErrors(400, 404)
  detail(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string): Promise<AdminUserDetailDto> {
    return this.users.detail(ctx, id);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.suspend')
  @ApiOperation({ summary: 'Suspend an account (optionally until a date); revokes its sessions', description: RANK_NOTE })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AccountStatusResultDto })
  @ApiErrors(400, 404, 409)
  async suspend(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: SuspendUserDto): Promise<AccountStatusResultDto> {
    const r = await this.governance.suspend(ctx, id, { reason: dto.reason, expiresAt: dto.expiresAt ?? null });
    return { id, status: r.status as UserStatusEnum };
  }

  @Post(':id/reinstate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.suspend')
  @ApiOperation({ summary: 'Lift a suspension', description: RANK_NOTE })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AccountStatusResultDto })
  @ApiErrors(400, 404, 409)
  async reinstate(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: ReasonDto): Promise<AccountStatusResultDto> {
    const r = await this.governance.reinstate(ctx, id, dto.reason);
    return { id, status: r.status as UserStatusEnum };
  }

  @Post(':id/ban')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.ban')
  @ApiOperation({ summary: 'Ban an account indefinitely (step-up + typed username confirmation)', description: RANK_NOTE })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AccountStatusResultDto })
  @ApiErrors(400, 404, 409)
  @ApiStepUp()
  async ban(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: BanUserDto): Promise<AccountStatusResultDto> {
    const r = await this.governance.ban(ctx, id, dto);
    return { id, status: r.status as UserStatusEnum };
  }

  @Post(':id/unban')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.ban')
  @ApiOperation({ summary: 'Lift a ban (step-up)', description: RANK_NOTE })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AccountStatusResultDto })
  @ApiErrors(400, 404, 409)
  @ApiStepUp()
  async unban(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: ReasonDto): Promise<AccountStatusResultDto> {
    const r = await this.governance.unban(ctx, id, dto.reason);
    return { id, status: r.status as UserStatusEnum };
  }

  @Post(':id/warnings')
  @RequirePermissions('users.warn')
  @ApiOperation({ summary: 'Issue a policy warning (delivered to the user’s in-app inbox)', description: RANK_NOTE })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: WarningCreatedDto })
  @ApiErrors(400, 404)
  async warn(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: WarnUserDto): Promise<WarningCreatedDto> {
    const r = await this.governance.warn(ctx, id, dto);
    return { ...r, delivery: 'IN_APP_INBOX' };
  }

  @Patch(':id/role')
  @RequirePermissions('users.roles.manage')
  @ApiOperation({
    summary: 'Change an account’s role (step-up)',
    description:
      'Only roles below your own can be granted (SUPER_ADMIN may grant any); ADMIN/SUPER_ADMIN changes need `admins.manage`; ' +
      'the last active SUPER_ADMIN cannot be demoted (409 `LAST_SUPER_ADMIN`).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RoleResultDto })
  @ApiErrors(400, 404, 409)
  @ApiStepUp()
  async role(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: ChangeRoleDto): Promise<RoleResultDto> {
    const r = await this.governance.setRole(ctx, id, dto.role);
    return { id, role: r.role as RoleResultDto['role'] };
  }

  @Patch(':id/verified')
  @RequirePermissions('users.update')
  @ApiOperation({ summary: 'Grant or remove the blue verification badge', description: 'Shown next to the name everywhere. Audited as `user.verified` / `user.unverified`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VerifiedResultDto })
  @ApiErrors(400, 404)
  setVerified(@ReqContext() ctx: RequestContext, @Param('id', UuidPipe) id: string, @Body() dto: SetVerifiedDto): Promise<VerifiedResultDto> {
    return this.governance.setVerified(ctx, id, dto.verified);
  }

  @Post(':id/content/moderation')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('posts.read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Hide, remove or restore all of an account’s content at once (step-up + typed username)',
    description:
      `${RANK_NOTE} Needs \`posts.moderate\` + \`reels.moderate\` for posts and \`comments.moderate\` for comments. ` +
      'Reversible: `ACTIVE` restores everything currently hidden or removed in the scope. Nothing is deleted; each item is audited.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BulkModerationResultDto })
  @ApiErrors(400, 404)
  @ApiStepUp()
  async moderateContent(
    @ReqContext() ctx: RequestContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: BulkModerateUserContentDto,
  ): Promise<BulkModerationResultDto> {
    await this.stepUp.assert(ctx);
    const user = await this.users.detail(ctx, id);
    if (dto.confirmUsername !== user.user.username)
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Validation failed', [
        { field: 'confirmUsername', message: 'Type the account’s username to confirm' },
      ]);
    return this.moderation.bulkForAuthor(ctx, id, {
      scope: dto.scope,
      status: dto.status,
      reason: dto.reason,
      resolveReports: dto.resolveReports,
    });
  }
}
