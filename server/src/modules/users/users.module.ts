import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { UploadsMulterModule } from '../media/multer.options.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [MediaModule, UploadsMulterModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
