import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Viewer } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { ApiAuth, ApiErrors, ApiOptionalAuth } from '../../common/swagger/api-docs.decorators.js';
import { UploadMediaDto } from '../media/dto/media.dto.js';
import { MeDto, UpdateProfileDto, UserProfileDto } from './dto/user.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Static `me` routes are declared before `:username` so they always take precedence;
  // "me" is also a reserved username.
  @Get('me')
  @ApiAuth()
  @ApiOperation({ summary: 'Get the authenticated user (private profile incl. email)' })
  @ApiOkResponse({ type: MeDto })
  getMe(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.users.getMe(user.id);
  }

  @Patch('me')
  @ApiAuth()
  @ApiOperation({ summary: 'Update own profile' })
  @ApiOkResponse({ type: MeDto })
  @ApiErrors(400, 409)
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<MeDto> {
    return this.users.updateMe(user.id, dto);
  }

  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiAuth()
  @ApiOperation({ summary: 'Upload and set avatar (image only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadMediaDto })
  @ApiOkResponse({ type: MeDto })
  @ApiErrors(400, 413, 415)
  setAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File): Promise<MeDto> {
    return this.users.setProfileImage(user.id, 'avatar', file);
  }

  @Delete('me/avatar')
  @ApiAuth()
  @ApiOperation({ summary: 'Remove avatar' })
  @ApiOkResponse({ type: MeDto })
  removeAvatar(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.users.removeProfileImage(user.id, 'avatar');
  }

  @Post('me/cover')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiAuth()
  @ApiOperation({ summary: 'Upload and set cover photo (image only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadMediaDto })
  @ApiOkResponse({ type: MeDto })
  @ApiErrors(400, 413, 415)
  setCover(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File): Promise<MeDto> {
    return this.users.setProfileImage(user.id, 'cover', file);
  }

  @Delete('me/cover')
  @ApiAuth()
  @ApiOperation({ summary: 'Remove cover photo' })
  @ApiOkResponse({ type: MeDto })
  removeCover(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.users.removeProfileImage(user.id, 'cover');
  }

  @Public()
  @Get(':username')
  @ApiOptionalAuth()
  @ApiOperation({
    summary: 'Get a public profile by username (case-insensitive)',
    description: 'Returns 404 for unknown, suspended or blocking accounts. Never exposes email or other private data.',
  })
  @ApiParam({ name: 'username', example: 'jane_doe' })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiErrors(404)
  getProfile(@Param('username') username: string, @Viewer() viewer: AuthUser | null): Promise<UserProfileDto> {
    return this.users.getProfile(username, viewer?.id ?? null);
  }
}
