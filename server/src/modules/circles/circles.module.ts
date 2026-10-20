import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { UsersModule } from '../users/users.module.js';
import { CirclesController } from './circles.controller.js';
import { CirclesService } from './circles.service.js';

@Module({
  imports: [MediaModule, UsersModule],
  controllers: [CirclesController],
  providers: [CirclesService],
})
export class CirclesModule {}
