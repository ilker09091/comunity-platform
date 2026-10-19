import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { UsersModule } from '../users/users.module.js';
import { MediaModule } from '../media/media.module.js';
import { FollowsController } from './follows.controller.js';
import { FollowsService } from './follows.service.js';

@Module({
  imports: [UsersModule, NotificationsModule, MediaModule],
  controllers: [FollowsController],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
