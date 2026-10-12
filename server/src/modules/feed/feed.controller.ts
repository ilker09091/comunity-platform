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
    description: 'Version 2: hard eligibility, discovery/cooldown tiers, then normalized weighted ranking. Actual visible impressions are separate from delivery/preload; exact liked/saved items receive a longer repeat cooldown. Cooldowns relax after better candidates are exhausted. Continuous discovery in cycles. Cycle 1 serves Reels the viewer has not meaningfully watched; when it is exhausted the next cycle starts automatically with every eligible Reel in a new, relevance-weighted shuffled order (never opening with the Reel just shown). A Reel appears at most once per cycle; use `entries[].key` as queue identity. Bounded PostgreSQL ranking, 48-hour sessions, signed keyset cursors, creator diversity. `hasMore` is false only when nothing eligible remains (0 Reels, or a single Reel that simply loops). Privacy, blocks, reports and moderation are checked on every page; persistent watch history is never reset.',
  })
  @ApiOkResponse({ type: ReelsPageDto })
  @ApiErrors(400)
  reels(@Viewer() viewer: AuthUser | null, @Query() q: ReelsQueryDto): Promise<ReelsPageDto> {
    return this.recommendations.page(viewer?.id ?? null,q);
  }

  @Public() @Post('reels/expose') @HttpCode(200)
  @ApiOptionalAuth() @ApiOperation({summary:'Register visible exposure or prepare active playback for an exact occurrence',description:'Does not reset the session or persistent history. Only playable, visible originals/quotes are accepted. prepare=true initializes active playback without an impression. Otherwise visibleMs>=750 records a single impression for the exact position.'})
  @ApiOkResponse({type:ReelExposureDto}) @ApiErrors(400,404)
  expose(@Viewer() viewer:AuthUser|null,@Body() body:ReelExposeDto):Promise<ReelExposureDto> {return this.recommendations.expose(viewer?.id??null,body);}

  @Public() @Post('reels/watch') @HttpCode(204)
  @Throttle({default:{limit:90,ttl:60000}})
  @ApiOptionalAuth() @ApiOperation({summary:'Batch meaningful Reel playback events',description:'1–20 events, monotonic idempotent sequences. Requires a prepared active entry and VIDEO_START. Events bind to immutable positions; prefetched items never call prepare/expose. Duration/position are validated and credited time is bounded by server elapsed time. Meaningful = 50% for videos under 4s, otherwise max(2s,10% of duration), capped at 8s. Completion requires 95% of videos under 2s, 90% over 60s and 85% otherwise. Early skips are counted once, separately from completion. Guests keep temporary impression history; signed-in users retain aggregates across sessions.'})
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
