import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/auth.decorators.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-docs.decorators.js';
import { CursorQueryDto, Paginated } from '../../common/dto/common.dto.js';
import { GroupsService } from './groups.service.js';
import { CreateGroupDto, GroupAckDto, GroupAvatarDto, GroupDetailDto, GroupDto, GroupMembersDto, GroupMessageDto, RenameGroupDto } from './groups.dto.js';
import { EditMessageDto, SendMessageDto } from './social.dto.js';

@ApiTags('Group chats') @ApiAuth() @ApiErrors(400,401,403,404)
@Controller('group-chats')
export class GroupsController {
  constructor(private readonly groups:GroupsService){}
  @Post() @ApiOperation({operationId:'groupsCreate',summary:'Create a private group chat with accepted contacts'}) @ApiCreatedResponse({type:GroupDetailDto})
  create(@CurrentUser() u:AuthUser,@Body() dto:CreateGroupDto){return this.groups.create(u.id,dto);}
  @Get() @ApiOperation({operationId:'groupsList',summary:'Your group conversations, most recently active first'}) @ApiOkResponse({type:Paginated(GroupDto)})
  list(@CurrentUser() u:AuthUser,@Query() q:CursorQueryDto){return this.groups.list(u.id,q.cursor,q.limit??20);}
  @Get(':id') @ApiOperation({operationId:'groupsGet',summary:'Group settings and current members'}) @ApiOkResponse({type:GroupDetailDto})
  get(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.groups.get(u.id,id);}
  @Patch(':id') @ApiOperation({operationId:'groupsRename',summary:'Group owner renames the conversation'}) @ApiOkResponse({type:GroupDetailDto})
  rename(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:RenameGroupDto){return this.groups.rename(u.id,id,dto.name);}
  @Post(':id/avatar') @HttpCode(200) @ApiOperation({operationId:'groupsSetAvatar',summary:'Group owner sets an uploaded photo'}) @ApiOkResponse({type:GroupDetailDto})
  avatar(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:GroupAvatarDto){return this.groups.setAvatar(u.id,id,dto.mediaId);}
  @Delete(':id/avatar') @HttpCode(200) @ApiOperation({operationId:'groupsRemoveAvatar',summary:'Group owner removes the group photo'}) @ApiOkResponse({type:GroupDetailDto})
  removeAvatar(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.groups.setAvatar(u.id,id,null);}
  @Post(':id/members') @ApiOperation({operationId:'groupsAddMembers',summary:'Group owner adds accepted contacts'}) @ApiCreatedResponse({type:GroupDetailDto})
  members(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:GroupMembersDto){return this.groups.members(u.id,id,dto.memberIds);}
  @Delete(':id/members/:userId') @HttpCode(204) @ApiOperation({operationId:'groupsRemoveMember',summary:'Owner removes a member'}) @ApiNoContentResponse()
  remove(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('userId',ParseUUIDPipe) target:string){return this.groups.removeMember(u.id,id,target);}
  @Delete(':id/membership') @HttpCode(204) @ApiOperation({operationId:'groupsLeave',summary:'Leave; transfer ownership or delete the empty group'}) @ApiNoContentResponse()
  leave(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.groups.leave(u.id,id);}
  @Get(':id/messages') @ApiOperation({operationId:'groupsMessages',summary:'Group messages with current attachments and receipts'}) @ApiOkResponse({type:Paginated(GroupMessageDto)})
  history(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query() q:CursorQueryDto){return this.groups.history(u.id,id,q.cursor,q.limit??30);}
  @Post(':id/messages') @ApiOperation({operationId:'groupsSend',summary:'Send a group message or attachment'}) @ApiCreatedResponse({type:GroupMessageDto})
  send(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SendMessageDto){return this.groups.send(u.id,id,dto);}
  @Patch(':id/messages/:messageId') @ApiOperation({operationId:'groupsEdit',summary:'Edit your own group message'}) @ApiOkResponse({type:GroupMessageDto})
  edit(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('messageId',ParseUUIDPipe) message:string,@Body() dto:EditMessageDto){return this.groups.edit(u.id,id,message,dto.content);}
  @Delete(':id/messages/:messageId') @HttpCode(204) @ApiOperation({operationId:'groupsUnsend',summary:'Unsend your own group message'}) @ApiNoContentResponse()
  unsend(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('messageId',ParseUUIDPipe) message:string){return this.groups.unsend(u.id,id,message);}
  @Post(':id/receipts') @HttpCode(204) @ApiOperation({operationId:'groupsAcknowledge',summary:'Confirm delivered/read group messages on this device'}) @ApiNoContentResponse()
  acknowledge(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:GroupAckDto){return this.groups.acknowledge(u.id,id,dto.messageId,dto.read);}
}
