import { Module } from '@nestjs/common';
import { CommentsModule } from '../comments/comments.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { UsersModule } from '../users/users.module.js';
import { ModerationController, ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [PostsModule, CommentsModule, UsersModule],
  controllers: [ReportsController, ModerationController],
  providers: [ReportsService],
})
export class ReportsModule {}
