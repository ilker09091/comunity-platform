import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, Viewer } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { Paginated } from '../../common/dto/common.dto.js';
import type { Page } from '../../common/dto/common.dto.js';
import { ApiAuth, ApiErrors, ApiOptionalAuth } from '../../common/swagger/api-docs.decorators.js';
import { PostDto } from '../posts/dto/post.dto.js';
import { FeedService } from './feed.service.js';
import { ContentQueryDto } from '../../common/dto/content-query.dto.js';
import { ReelsService } from './reels.service.js';
import { ReelExposeDto, ReelExposureDto, ReelFeedbackDto, ReelsPageDto, ReelsQueryDto, ReelWatchBatchDto } from './reels.dto.js';

@ApiTags('Feed')
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService,private readonly recommendations:ReelsService) {}

  @Public()
  @Get('global')
  @ApiOptionalAuth()
  @ApiOperation({ summary: 'Home feed: public text/image posts and quotes', description: 'Server-side attachment classification defaults to home. content=all is available to other clients. Ordered by (createdAt desc, id desc).' })
  @ApiOkResponse({ type: Paginated(PostDto) })
  @ApiErrors(400)
  global(@Viewer() viewer: AuthUser | null, @Query() q: ContentQueryDto): Promise<Page<PostDto>> {
    return this.feed.global(viewer?.id ?? null, q.cursor, q.limit ?? 20, q.content);
  }

  @Get('following')
  @ApiAuth()
  @ApiOperation({
    summary: 'Following feed: followed accounts + your own posts, quotes and reposts',
    description: 'Ordered by (createdAt desc, id desc). Reposts appear as kind=REPOST items.',
  })
  @ApiOkResponse({ type: Paginated(PostDto) })
  @ApiErrors(400)
  following(@CurrentUser() user: AuthUser, @Query() q: ContentQueryDto): Promise<Page<PostDto>> {
    return this.feed.following(user.id, q.cursor, q.limit ?? 20, q.content);
  }

  @Public()
  @Get('reels')
  @ApiOptionalAuth()
  @ApiOperation({
    summary: 'Persistent personalized Reels discovery',
    description: 'Bounded PostgreSQL ranking, 48-hour sessions, signed stable cursors, creator diversity and persistent meaningful-watch exclusions. Reposts are resolved to their original, not duplicated. Privacy, blocks, reports and moderation are checked on every page. Exhaustion never silently recycles; omit session/cursor to refresh, or explicitly request rewatch=true for a new discovery cycle.',
  })
  @ApiOkResponse({ type: ReelsPageDto })
  @ApiErrors(400)
  reels(@Viewer() viewer: AuthUser | null, @Query() q: ReelsQueryDto): Promise<ReelsPageDto> {
    return this.recommendations.page(viewer?.id ?? null,q);
  }

  @Public() @Post('reels/expose') @HttpCode(200)
  @ApiOptionalAuth() @ApiOperation({summary:'Register an exact direct-linked Reel in the existing recommendation session',description:'Does not reset the session or persistent history. Only playable, visible originals/quotes are accepted.'})
  @ApiOkResponse({type:ReelExposureDto}) @ApiErrors(400,404)
  expose(@Viewer() viewer:AuthUser|null,@Body() body:ReelExposeDto):Promise<ReelExposureDto> {return this.recommendations.expose(viewer?.id??null,body);}

  @Public() @Post('reels/watch') @HttpCode(204)
  @Throttle({default:{limit:90,ttl:60000}})
  @ApiOptionalAuth() @ApiOperation({summary:'Batch meaningful Reel playback events',description:'1–20 events, monotonic idempotent sequences. Requires exposure and VIDEO_START. Duration/position are validated and credited time is bounded by server elapsed time. Meaningful = 2 seconds or 50% of a short video (minimum 250ms). Guests keep temporary impression history; signed-in users retain aggregates across sessions.'})
  @ApiNoContentResponse() @ApiErrors(400,404,429)
  watch(@Viewer() viewer:AuthUser|null,@Body() body:ReelWatchBatchDto):Promise<void> {return this.recommendations.watch(viewer?.id??null,body);}

  @Post('reels/feedback') @HttpCode(204)
  @ApiAuth() @ApiOperation({summary:'Set or remove Not Interested feedback',description:'Hides the exact recommendation and reduces creator affinity. Does not change post visibility or count as positive engagement.'})
  @ApiNoContentResponse() @ApiErrors(400,401,404)
  feedback(@CurrentUser() user:AuthUser,@Body() body:ReelFeedbackDto):Promise<void> {return this.recommendations.feedback(user.id,body);}

  @Public()
  @Get('explore')
  @ApiOptionalAuth()
  @ApiOperation({
    summary: 'Explore feed: recent public posts ranked by engagement',
    description:
      'score = (likes + 2·comments + 3·(reposts+quotes) + bookmarks + 1) / (ageHours + 2)^1.5 over the last ' +
      'EXPLORE_WINDOW_HOURS (default 72). The cursor pins the ranking instant so pages are stable.',
  })
  @ApiOkResponse({ type: Paginated(PostDto) })
  @ApiErrors(400)
  explore(@Viewer() viewer: AuthUser | null, @Query() q: ContentQueryDto): Promise<Page<PostDto>> {
    return this.feed.explore(viewer?.id ?? null, q.cursor, q.limit ?? 20, q.content);
  }
}
