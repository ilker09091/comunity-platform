import { Module } from '@nestjs/common';
import { AdminImporterService } from './admin-importer.service.js';
import { AdminImporterController } from './controllers/admin-importer.controller.js';
import { MediaModule } from '../media/media.module.js';
import { AdminAnalyticsService } from './admin-analytics.service.js';
import { AdminAnnouncementsService } from './admin-announcements.service.js';
import { AdminContentService } from './admin-content.service.js';
import { AdminDeletionService } from './admin-deletion.service.js';
import { AdminGuard } from './admin.guard.js';
import { AdminMediaService } from './admin-media.service.js';
import { AdminOpsService } from './admin-ops.service.js';
import { AdminPinsService } from './admin-pins.service.js';
import { AdminReadService } from './admin-read.service.js';
import { AdminReportsService } from './admin-reports.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminAnalyticsController, AdminCoreController } from './controllers/admin-core.controller.js';
import { AdminContentController } from './controllers/admin-content.controller.js';
import {
  AdminAnnouncementsController,
  AdminMediaController,
  AdminReportsController,
  AdminSettingsController,
  AdminSystemController,
} from './controllers/admin-ops.controller.js';
import { AdminUsersController } from './controllers/admin-users.controller.js';

/**
 * Admin control center API (`/api/admin/*`). Every controller is protected by AdminGuard
 * (staff role + per-handler permissions); governance rules live in the global PlatformModule.
 */
@Module({
  imports: [MediaModule],
  controllers: [
    AdminImporterController,
    AdminCoreController,
    AdminAnalyticsController,
    AdminUsersController,
    AdminContentController,
    AdminMediaController,
    AdminReportsController,
    AdminAnnouncementsController,
    AdminSettingsController,
    AdminSystemController,
  ],
  providers: [
    AdminImporterService,
    AdminGuard,
    AdminReadService,
    AdminUsersService,
    AdminContentService,
    AdminDeletionService,
    AdminMediaService,
    AdminReportsService,
    AdminAnnouncementsService,
    AdminAnalyticsService,
    AdminOpsService,
    AdminPinsService,
  ],
})
export class AdminModule {}
