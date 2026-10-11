import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { CountDto, Paginated } from '../../common/dto/common.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { UuidPipe } from '../../common/errors/validation.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import { MarkAllReadResultDto, NotificationDto, NotificationsQueryDto } from './dto/notification.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('Notifications')
@ApiAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications (newest first)', description: 'Polling-compatible; cursor-paginated.' })
  @ApiOkResponse({ type: Paginated(NotificationDto) })
  @ApiErrors(400)
  list(@CurrentUser() user: AuthUser, @Query() q: NotificationsQueryDto): Promise<Page<NotificationDto>> {
    return this.notifications.list(user.id, { cursor: q.cursor, limit: q.limit ?? 20, unreadOnly: q.unreadOnly });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications' })
  @ApiOkResponse({ type: CountDto })
  async unreadCount(@CurrentUser() user: AuthUser): Promise<CountDto> {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiOkResponse({ type: MarkAllReadResultDto })
  async markAllRead(@CurrentUser() user: AuthUser): Promise<MarkAllReadResultDto> {
    return { updated: await this.notifications.markAllRead(user.id) };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one notification as read (idempotent)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Marked as read' })
  @ApiErrors(400, 404)
  async markRead(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.notifications.markRead(user.id, id);
  }
}
