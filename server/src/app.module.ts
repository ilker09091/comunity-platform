import { Logger, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RequestLoggingMiddleware } from './common/middleware/request-logging.middleware.js';
import { appConfig } from './config/app.config.js';
import { buildDataSourceOptions } from './database/data-source.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BookmarksModule } from './modules/bookmarks/bookmarks.module.js';
import { CommentsModule } from './modules/comments/comments.module.js';
import { FeedModule } from './modules/feed/feed.module.js';
import { FollowsModule } from './modules/follows/follows.module.js';
import { LikesModule } from './modules/likes/likes.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { InboxModule } from './modules/inbox/inbox.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PostsModule } from './modules/posts/posts.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { RepostsModule } from './modules/reposts/reposts.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { UsersModule } from './modules/users/users.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'server',
    }),
    ConfigModule.forRoot({ isGlobal: true, cache: true, load: [appConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: ConfigType<typeof appConfig>) => {
        if (config.db.synchronizeRequested) {
          new Logger('Database').warn(
            'DB_SYNCHRONIZE is set but ignored: the schema is managed exclusively by migrations (npm run migration:run).',
          );
        }
        return buildDataSourceOptions(config.db);
      },
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: ConfigType<typeof appConfig>) => ({
        throttlers: [{ name: 'default', ttl: config.throttle.ttlSeconds * 1000, limit: config.throttle.limit }],
        skipIf: () => !config.throttle.enabled,
      }),
    }),
    PlatformModule,
    MediaModule,
    UsersModule,
    AuthModule,
    NotificationsModule,
    FollowsModule,
    PostsModule,
    LikesModule,
    CommentsModule,
    BookmarksModule,
    RepostsModule,
    FeedModule,
    SearchModule,
    ReportsModule,
    InboxModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*path');
  }
}
