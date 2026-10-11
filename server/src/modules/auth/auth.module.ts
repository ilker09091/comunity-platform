import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { MaintenanceGuard } from '../platform/maintenance.guard.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  // Secrets are passed explicitly per sign/verify call (access vs refresh secret).
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Every route is protected unless marked @Public(); roles are checked afterwards.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Read-only maintenance mode (needs the authenticated user, so it runs after the guards above).
    { provide: APP_GUARD, useExisting: MaintenanceGuard },
  ],
})
export class AuthModule {}
