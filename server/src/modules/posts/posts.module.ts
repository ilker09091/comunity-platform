import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { UsersModule } from '../users/users.module.js';
import { PostsQueryService } from './posts-query.service.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';
import { PostInteractionsController, PostInteractionsService } from './post-interactions.js';

@Module({
  imports: [MediaModule, UsersModule],
  controllers: [PostsController, PostInteractionsController],
  providers: [PostsService, PostsQueryService, PostInteractionsService],
  exports: [PostsService, PostsQueryService],
})
export class PostsModule {}
