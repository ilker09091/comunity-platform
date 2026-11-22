import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/auth.decorators.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import { CursorQueryDto, Paginated } from '../../common/dto/common.dto.js';
import { GroupsService } from './groups.service.js';
import {
  CreateGroupDto, GroupAckDto, GroupAvatarDto, GroupDetailDto, GroupDto, GroupMediaListDto, GroupMembersDto, GroupMessageDto,
  GroupMuteDto, GroupPermissionsDto, GroupPinDto, GroupReceiptsDto, GroupRoleDto, UpdateGroupDto,
} from './groups.dto.js';
import { EditMessageDto, SendMessageDto } from './social.dto.js';

@ApiTags('Group chats') @ApiAuth() @ApiErrors(400,401,403,404)
@Controller('group-chats')
export class GroupsController {
  constructor(private readonly groups:GroupsService){}
  @Post() @ApiOperation({operationId:'groupsCreate',summary:'Create a private group chat with accepted contacts'}) @ApiCreatedResponse({type:GroupDetailDto})
  create(@CurrentUser() u:AuthUser,@Body() dto:CreateGroupDto){return this.groups.create(u.id,dto);}
  @Get() @ApiOperation({operationId:'groupsList',summary:'Your group conversations, most recently active first'}) @ApiOkResponse({type:Paginated(GroupDto)})
  list(@CurrentUser() u:AuthUser,@Query() q:CursorQueryDto){return this.groups.list(u.id,q.cursor,q.limit??20);}
  @Get(':id') @ApiOperation({operationId:'groupsGet',summary:'Group info, settings and members'}) @ApiOkResponse({type:GroupDetailDto})
  get(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.groups.get(u.id,id);}
  @Patch(':id') @ApiOperation({operationId:'groupsUpdate',summary:'Change the group name or description'}) @ApiOkResponse({type:GroupDetailDto})
  update(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:UpdateGroupDto){return this.groups.update(u.id,id,dto);}
  @Delete(':id') @HttpCode(204) @ApiOperation({operationId:'groupsDelete',summary:'Owner deletes the group for everyone'}) @ApiNoContentResponse()
  remove(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.groups.remove(u.id,id);}
  @Patch(':id/permissions') @ApiOperation({operationId:'groupsPermissions',summary:'Owner sets what members (not only admins) may do'}) @ApiOkResponse({type:GroupDetailDto})
  permissions(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:GroupPermissionsDto){return this.groups.permissions(u.id,id,dto);}
  @Post(':id/avatar') @HttpCode(200) @ApiOperation({operationId:'groupsSetAvatar',summary:'Set an uploaded photo as the group photo'}) @ApiOkResponse({type:GroupDetailDto})
  avatar(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:GroupAvatarDto){return this.groups.setAvatar(u.id,id,dto.mediaId);}
  @Delete(':id/avatar') @HttpCode(200) @ApiOperation({operationId:'groupsRemoveAvatar',summary:'Remove the group photo'}) @ApiOkResponse({type:GroupDetailDto})
  removeAvatar(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.groups.setAvatar(u.id,id,null);}
  @Post(':id/members') @ApiOperation({operationId:'groupsAddMembers',summary:'Add accepted contacts'}) @ApiCreatedResponse({type:GroupDetailDto})
  members(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:GroupMembersDto){return this.groups.members(u.id,id,dto.memberIds);}
  @Patch(':id/members/:userId') @ApiOperation({operationId:'groupsSetRole',summary:'Owner makes someone an admin, a member again, or the new owner'}) @ApiOkResponse({type:GroupDetailDto})
  role(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('userId',ParseUUIDPipe) target:string,@Body() dto:GroupRoleDto){return this.groups.setRole(u.id,id,target,dto.role);}
  @Delete(':id/members/:userId') @HttpCode(204) @ApiOperation({operationId:'groupsRemoveMember',summary:'An admin removes a member'}) @ApiNoContentResponse()
  removeMember(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('userId',ParseUUIDPipe) target:string){return this.groups.removeMember(u.id,id,target);}
  @Delete(':id/membership') @HttpCode(204) @ApiOperation({operationId:'groupsLeave',summary:'Leave; an admin (or the longest member) takes over, the last one out deletes it'}) @ApiNoContentResponse()
  leave(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.groups.leave(u.id,id);}
  @Post(':id/pin') @HttpCode(200) @ApiOperation({operationId:'groupsPin',summary:'Pin a message at the top of the chat (null unpins)'}) @ApiOkResponse({type:GroupDetailDto})
  pin(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:GroupPinDto){return this.groups.pin(u.id,id,dto.messageId);}
  @Patch(':id/mute') @ApiOperation({operationId:'groupsMute',summary:'Turn notifications for this group off or on'}) @ApiOkResponse({type:GroupDetailDto})
  mute(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:GroupMuteDto){return this.groups.mute(u.id,id,dto.muted);}
  @Get(':id/media') @ApiOperation({operationId:'groupsMedia',summary:'Photos and videos shared in the group'}) @ApiOkResponse({type:GroupMediaListDto})
  media(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.groups.sharedMedia(u.id,id);}
  @Get(':id/messages') @ApiOperation({operationId:'groupsMessages',summary:'Group messages with current attachments and receipts'}) @ApiOkResponse({type:Paginated(GroupMessageDto)})
  history(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query() q:CursorQueryDto){return this.groups.history(u.id,id,q.cursor,q.limit??30);}
  @Post(':id/messages') @ApiOperation({operationId:'groupsSend',summary:'Send a group message or attachment'}) @ApiCreatedResponse({type:GroupMessageDto})
  send(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SendMessageDto){return this.groups.send(u.id,id,dto);}
  @Get(':id/messages/:messageId/receipts') @ApiOperation({operationId:'groupsReceipts',summary:'Who has seen a message, who got it and who has not yet'}) @ApiOkResponse({type:GroupReceiptsDto})
  receipts(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('messageId',ParseUUIDPipe) message:string){return this.groups.receipts(u.id,id,message);}
  @Patch(':id/messages/:messageId') @ApiOperation({operationId:'groupsEdit',summary:'Edit your own group message'}) @ApiOkResponse({type:GroupMessageDto})
  edit(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('messageId',ParseUUIDPipe) message:string,@Body() dto:EditMessageDto){return this.groups.edit(u.id,id,message,dto.content);}
  @Delete(':id/messages/:messageId') @HttpCode(204) @ApiOperation({operationId:'groupsUnsend',summary:'Unsend your own group message'}) @ApiNoContentResponse()
  unsend(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('messageId',ParseUUIDPipe) message:string){return this.groups.unsend(u.id,id,message);}
  @Post(':id/receipts') @HttpCode(204) @ApiOperation({operationId:'groupsAcknowledge',summary:'Confirm delivered/read group messages on this device'}) @ApiNoContentResponse()
  acknowledge(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:GroupAckDto){return this.groups.acknowledge(u.id,id,dto.messageId,dto.read);}
}
