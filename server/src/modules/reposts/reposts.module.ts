import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { UsersModule } from '../users/users.module.js';
import { RepostsController } from './reposts.controller.js';
import { RepostsService } from './reposts.service.js';

@Module({
  imports: [PostsModule, NotificationsModule, UsersModule],
  controllers: [RepostsController],
  providers: [RepostsService],
})
export class RepostsModule {}
