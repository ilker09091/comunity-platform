import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { iso } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { PushService } from './push.service.js';
import {
  catchesCold,
  CHAT_HAPPINESS,
  CLEAN_HOURS,
  COINS,
  DAILY_LIMITS,
  decayed,
  energyOf,
  FALLBACK_FIRST_WORD,
  FAMILY_HUG_HAPPINESS,
  FAMILY_HUG_MINUTES,
  FEED_FULLNESS,
  CLEAN_AT,
  favoriteWord,
  FREE_TOYS,
  FULL_AT,
  HERE_SECONDS,
  HUG_COOLDOWN_MINUTES,
  RESTED_AT,
  FULLNESS_HOURS,
  grantedXp,
  HAPPINESS_HOURS,
  HUG_HAPPINESS,
  LOVE_WORDS,
  MAX_SLEEP_HOURS,
  moodOf,
  PLAY_HAPPINESS,
  SHOP,
  SOLO_CURE_HOURS,
  STAGE_NAMES,
  stageOf,
  teachableWord,
  WORD_STAGE,
  wordToLearn,
  XP,
  type CareKind,
  type DecorSlot,
  type Scene,
  type Signal,
} from './baby.js';
import type { BabyDto, BabyInviteDto, BabyMomentDto } from './social.dto.js';

type BabyRow = {
  id: string; low_id: string; high_id: string; name: string; gender: 'girl' | 'boy';
  status: 'pending' | 'active' | 'declined' | 'ended'; requested_by: string; born_at: Date | null;
  xp: number; fullness: number; fullness_at: Date; happiness: number; happiness_at: Date; outfit: number;
  coins: number; clean: number; clean_at: Date; energy: number; energy_at: Date; asleep_at: Date | null;
  sick_since: Date | null; medicine_by: string[]; medicine_at: Date | null; owned: string[];
  decor: Partial<Record<DecorSlot, string>>; photo_message_id: string | null;
  hug_low_at: Date | null; hug_high_at: Date | null; last_hug_day: string | null; family_hugs: number;
};
type MomentRow = { id: string; kind: string; data: Record<string, unknown>; by_id: string | null; created_at: Date };
type Db = DataSource | EntityManager;

/** Days follow UTC, like message streaks. */
const TODAY = "(now() AT TIME ZONE 'UTC')::date";
const PAIR = 'low_id = least($1::uuid, $2::uuid) AND high_id = greatest($1::uuid, $2::uuid)';
const HOUR = 3_600_000;

/** "Our baby": state, daily care and growth of the child a couple raises in their chat. */
@Injectable()
export class BabiesService {
  private readonly logger = new Logger(BabiesService.name);
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly push: PushService,
    private readonly urls: MediaUrlService,
  ) {}

  invite(b: BabyRow): BabyInviteDto {
    return { id: b.id, name: b.name, gender: b.gender, status: b.status, requestedBy: b.requested_by };
  }

  async invites(ids: string[]) {
    if (!ids.length) return new Map<string, BabyInviteDto>();
    const rows = await sqlRows<BabyRow>(this.db, 'SELECT * FROM babies WHERE id = ANY($1::uuid[])', [ids]);
    return new Map(rows.map((b) => [b.id, this.invite(b)]));
  }

  /** Meters as they are right now (they run down between visits). */
  private meters(b: BabyRow, now = new Date()) {
    // Asleep, the child gets hungry, sad and dirty more slowly.
    const fullness = decayed(b.fullness, b.fullness_at, FULLNESS_HOURS, now, b.asleep_at);
    const happiness = decayed(b.happiness, b.happiness_at, HAPPINESS_HOURS, now, b.asleep_at);
    const clean = decayed(b.clean, b.clean_at, CLEAN_HOURS, now, b.asleep_at);
    const energy = energyOf(b.energy, b.energy_at, b.asleep_at, now);
    return { fullness, happiness, clean, energy, asleep: !!b.asleep_at, sick: !!b.sick_since };
  }

  private moment(r: MomentRow): BabyMomentDto {
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
      id: r.id, kind: r.kind, stage: num(r.data.stage), outfit: num(r.data.outfit), word: str(r.data.word),
      item: str(r.data.item), byId: r.by_id, createdAt: iso(r.created_at)!,
    };
  }

  private async remember(m: Db, babyId: string, kind: string, data: Record<string, unknown>, byId: string | null = null) {
    await sqlRows(m, 'INSERT INTO baby_moments(baby_id, kind, data, by_id, created_at) VALUES ($1, $2, $3, $4, clock_timestamp())', [babyId, kind, JSON.stringify(data), byId]);
  }

  async dto(m: Db, b: BabyRow, viewerId: string): Promise<BabyDto> {
    const [care, words, latest, photo] = await Promise.all([
      sqlRows<{ user_id: string } & Record<CareKind, number>>(
        m, `SELECT user_id, feeds, plays, chats, games, baths, sleeps FROM baby_care WHERE baby_id = $1 AND day = ${TODAY}`, [b.id]),
      sqlRows<{ word: string }>(m, 'SELECT word FROM baby_words WHERE baby_id = $1 ORDER BY learned_at DESC LIMIT 40', [b.id]),
      sqlOne<MomentRow>(m, 'SELECT * FROM baby_moments WHERE baby_id = $1 ORDER BY created_at DESC LIMIT 1', [b.id]),
      b.photo_message_id
        ? sqlOne<{ storage_key: string }>(m, `SELECT md.storage_key FROM direct_messages d JOIN media md ON md.id = d.media_id
            WHERE d.id = $1 AND NOT d.view_once`, [b.photo_message_id])
        : Promise.resolve(null),
    ]);
    const of = (userId: string) => {
      const r = care.find((c) => c.user_id === userId);
      return { feeds: r?.feeds ?? 0, plays: r?.plays ?? 0, chats: r?.chats ?? 0, games: r?.games ?? 0, baths: r?.baths ?? 0, sleeps: r?.sleeps ?? 0 };
    };
    const now = new Date();
    const meters = this.meters(b, now);
    const stage = stageOf(b.xp);
    const peerId = b.low_id === viewerId ? b.high_id : b.low_id;
    const myHug = b.low_id === viewerId ? b.hug_low_at : b.hug_high_at;
    const theirHug = b.low_id === viewerId ? b.hug_high_at : b.hug_low_at;
    const today = now.toISOString().slice(0, 10);
    return {
      ...this.invite(b),
      bornAt: iso(b.born_at),
      ageDays: b.born_at ? Math.floor((now.getTime() - b.born_at.getTime()) / 86_400_000) : 0,
      xp: b.xp,
      ...stage,
      stageName: STAGE_NAMES[stage.stage - 1],
      ...meters,
      medicineMine: b.medicine_by.includes(viewerId),
      medicineTheirs: b.medicine_by.includes(peerId),
      mood: moodOf(meters.fullness, meters.happiness, meters.clean, meters.energy, meters.sick),
      outfit: b.outfit,
      mine: of(viewerId),
      theirs: of(peerId),
      limits: { ...DAILY_LIMITS },
      coins: b.coins,
      owned: b.owned,
      decor: { room: b.decor.room ?? null, hang: b.decor.hang ?? null, floor: b.decor.floor ?? null, frame: b.decor.frame ?? null },
      photoUrl: photo ? this.urls.url(photo.storage_key) : null,
      myHugAt: iso(myHug),
      theirHugAt: iso(theirHug),
      familyHugToday: this.dayOf(b.last_hug_day) === today,
      familyHugs: b.family_hugs,
      words: words.map((w) => w.word),
      latestMoment: latest ? this.moment(latest) : null,
    };
  }

  /** `date` columns come back as a local-midnight Date (or a string, depending on driver settings). */
  private dayOf(value: unknown) {
    if (!value) return null;
    if (value instanceof Date) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    return String(value).slice(0, 10);
  }

  /**
   * Things that happen while nobody is looking: waking up after a long sleep, catching a cold,
   * a single dose of medicine finally working, and a toddler's first word. Idempotent.
   */
  private async tick(m: Db, b: BabyRow): Promise<BabyRow> {
    if (b.status !== 'active') return b;
    const now = Date.now();
    let row = b;
    const set = async (sql: string, params: unknown[]) => {
      const next = await sqlOne<BabyRow>(m, sql, params);
      if (next) row = next;
    };
    if (row.asleep_at && now - row.asleep_at.getTime() >= MAX_SLEEP_HOURS * HOUR) {
      // Woke up on their own: the meters (which ran down slowly in bed) start running at full speed from then.
      const wokeAt = new Date(row.asleep_at.getTime() + MAX_SLEEP_HOURS * HOUR);
      const m = this.meters(row, wokeAt);
      await set(`UPDATE babies SET energy = 100, energy_at = $2, asleep_at = NULL, fullness = $3, fullness_at = $2,
        happiness = $4, happiness_at = $2, clean = $5, clean_at = $2
        WHERE id = $1 AND asleep_at IS NOT NULL RETURNING *`, [row.id, wokeAt, m.fullness, m.happiness, m.clean]);
    }
    const meters = this.meters(row);
    if (!row.sick_since && catchesCold(meters.fullness, meters.clean, meters.happiness)) {
      await set('UPDATE babies SET sick_since = now(), medicine_by = \'{}\', medicine_at = NULL WHERE id = $1 AND sick_since IS NULL RETURNING *', [row.id]);
    } else if (row.sick_since && row.medicine_at && now - row.medicine_at.getTime() >= SOLO_CURE_HOURS * HOUR) {
      row = await this.cure(m, row, null);
    }
    if (stageOf(row.xp).stage >= WORD_STAGE && !(await sqlOne(m, 'SELECT 1 FROM baby_words WHERE baby_id = $1 LIMIT 1', [row.id]))) {
      await this.firstWord(m, row);
    }
    return row;
  }

  /** The open request or the child of this couple, if any. */
  async current(viewerId: string, peerId: string) {
    const found = await sqlOne<BabyRow>(this.db, `SELECT * FROM babies WHERE ${PAIR} AND status IN ('pending','active')`, [viewerId, peerId]);
    if (!found) return { baby: null };
    let b = found;
    try {
      b = await this.tick(this.db, found);
    } catch (error) {
      this.logger.warn({ message: 'Baby tick failed', error: (error as Error).message });
    }
    return { baby: await this.dto(this.db, b, viewerId) };
  }

  /** Inside a transaction: there is no open request or child yet. */
  async assertNone(m: Db, viewerId: string, peerId: string) {
    const b = await sqlOne<BabyRow>(m, `SELECT status FROM babies WHERE ${PAIR} AND status IN ('pending','active')`, [viewerId, peerId]);
    if (b) throw AppException.conflict(ErrorCode.CONFLICT, b.status === 'active' ? 'You already have a baby together' : 'A baby request is already waiting');
  }

  async create(m: Db, viewerId: string, peerId: string, name: string, gender: 'girl' | 'boy') {
    return (await sqlOne<BabyRow>(m, `INSERT INTO babies(low_id, high_id, name, gender, requested_by)
      VALUES (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid), $3, $4, $1) RETURNING *`, [viewerId, peerId, name.trim(), gender]))!;
  }

  private async lock(m: Db, viewerId: string, id: string) {
    const b = await sqlOne<BabyRow>(m, 'SELECT * FROM babies WHERE id = $1 AND $2::uuid IN (low_id, high_id) FOR UPDATE', [id, viewerId]);
    if (!b) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Baby not found');
    return b;
  }

  private async lockActive(m: Db, viewerId: string, id: string) {
    const b = await this.lock(m, viewerId, id);
    if (b.status !== 'active') throw AppException.badRequest(ErrorCode.INVALID_STATE, 'This baby is not with you right now');
    return this.tick(m, b);
  }

  private awake(b: BabyRow) {
    if (b.asleep_at) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} is sleeping. Wake them up first`);
  }

  /** The other parent says yes: the baby is born. */
  async accept(viewerId: string, id: string) {
    const b = await this.db.transaction(async (m) => {
      const b = await this.lock(m, viewerId, id);
      if (b.status !== 'pending') throw AppException.badRequest(ErrorCode.INVALID_STATE, 'This request is no longer open');
      if (b.requested_by === viewerId) throw AppException.forbidden(ErrorCode.INVALID_STATE, 'Wait for the other parent to accept');
      const born = (await sqlOne<BabyRow>(m, `UPDATE babies SET status = 'active', born_at = now(), fullness = 80, fullness_at = now(),
        happiness = 90, happiness_at = now(), clean = 100, clean_at = now(), energy = 90, energy_at = now(), coins = 50
        WHERE id = $1 RETURNING *`, [id]))!;
      await this.remember(m, id, 'born', { stage: 1, outfit: 0 });
      return born;
    });
    this.push.notifyUser(b.requested_by);
    return this.dto(this.db, b, viewerId);
  }

  /** Either person can withdraw or decline an open request. */
  async decline(viewerId: string, id: string) {
    await this.db.transaction(async (m) => {
      const b = await this.lock(m, viewerId, id);
      if (b.status !== 'pending') throw AppException.badRequest(ErrorCode.INVALID_STATE, 'This request is no longer open');
      await sqlRows(m, "UPDATE babies SET status = 'declined' WHERE id = $1", [id]);
    });
  }

  /** Says goodbye to the child for both parents (kept as history, never shown again). */
  async end(viewerId: string, id: string) {
    await this.db.transaction(async (m) => {
      const b = await this.lock(m, viewerId, id);
      if (b.status !== 'active') throw AppException.badRequest(ErrorCode.INVALID_STATE, 'This baby is not with you right now');
      await sqlRows(m, "UPDATE babies SET status = 'ended' WHERE id = $1", [id]);
    });
  }

  /** After XP went up: a new stage is a memory, fills the piggy bank, and may bring a first word. */
  private async grew(m: Db, before: BabyRow, after: BabyRow, byId: string | null) {
    const from = stageOf(before.xp).stage, to = stageOf(after.xp).stage;
    if (to <= from) return after;
    const next = (await sqlOne<BabyRow>(m, 'UPDATE babies SET coins = coins + $2 WHERE id = $1 RETURNING *', [after.id, COINS.stageUp]))!;
    await this.remember(m, after.id, 'stage', { stage: to, outfit: after.outfit }, byId);
    // Tell the other parent (never the one who just did it).
    if (byId !== after.low_id) this.push.notifyUser(after.low_id);
    if (byId !== after.high_id) this.push.notifyUser(after.high_id);
    if (to >= WORD_STAGE && from < WORD_STAGE) await this.firstWord(m, next);
    return next;
  }

  /**
   * Counts one care action of `userId` today, within the daily limit, and adds its XP and coins
   * (plus a bonus the first time both parents cared on the same day). Returns null over the limit.
   */
  private async award(m: Db, b: BabyRow, userId: string, kind: CareKind): Promise<BabyRow | null> {
    const xp = grantedXp(kind, this.meters(b).fullness, !!b.sick_since);
    const counted = await sqlOne(m, `INSERT INTO baby_care(baby_id, user_id, day, ${kind}, xp) VALUES ($1, $2, ${TODAY}, 1, $3)
      ON CONFLICT (baby_id, user_id, day) DO UPDATE SET ${kind} = baby_care.${kind} + 1, xp = baby_care.xp + EXCLUDED.xp
      WHERE baby_care.${kind} < $4 RETURNING 1`, [b.id, userId, xp, DAILY_LIMITS[kind]]);
    if (!counted) return null;
    const bonus = `(both_parents.ok AND b.last_bonus_day IS DISTINCT FROM ${TODAY})`;
    const after = (await sqlOne<BabyRow>(m, `WITH both_parents AS (
        SELECT count(*) = 2 AS ok FROM baby_care WHERE baby_id = $1 AND day = ${TODAY} AND xp > 0)
      UPDATE babies b SET
        xp = b.xp + $2 + CASE WHEN ${bonus} THEN $3 ELSE 0 END,
        coins = b.coins + $4 + CASE WHEN ${bonus} THEN $5 ELSE 0 END,
        last_bonus_day = CASE WHEN both_parents.ok THEN ${TODAY} ELSE b.last_bonus_day END
      FROM both_parents WHERE b.id = $1 RETURNING b.*`, [b.id, xp, XP.bothBonus, COINS[kind], COINS.bothBonus]))!;
    return this.grew(m, b, after, userId);
  }

  /** Runs `fn` on the locked, active child and returns the fresh state for the viewer. */
  private async act(viewerId: string, id: string, fn: (m: EntityManager, b: BabyRow) => Promise<BabyRow>) {
    const b = await this.db.transaction(async (m) => fn(m, await this.lockActive(m, viewerId, id)));
    return this.dto(this.db, b, viewerId);
  }

  feed(viewerId: string, id: string) {
    return this.act(viewerId, id, async (m, b) => {
      this.awake(b);
      const now = this.meters(b);
      if (now.fullness >= FULL_AT) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} is full right now. Try again a bit later`);
      // Feed first, so a hungry child's meal counts at full speed.
      const fed = (await sqlOne<BabyRow>(m, `UPDATE babies SET fullness = $2, fullness_at = now(), happiness = $3, happiness_at = now()
        WHERE id = $1 RETURNING *`, [b.id, Math.min(100, now.fullness + FEED_FULLNESS), Math.min(100, now.happiness + 5)]))!;
      const grown = await this.award(m, fed, viewerId, 'feeds');
      if (!grown) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} has eaten enough from you today`);
      return grown;
    });
  }

  play(viewerId: string, id: string, item: number) {
    return this.act(viewerId, id, async (m, b) => {
      this.awake(b);
      if (item >= FREE_TOYS && !b.owned.includes(`toy-${item}`)) throw AppException.badRequest(ErrorCode.INVALID_STATE, 'Buy this toy in the shop first');
      const grown = await this.award(m, b, viewerId, 'plays');
      if (!grown) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} is tired of playing with you today`);
      return (await sqlOne<BabyRow>(m, 'UPDATE babies SET happiness = $2, happiness_at = now() WHERE id = $1 RETURNING *',
        [b.id, Math.min(100, this.meters(grown).happiness + PLAY_HAPPINESS)]))!;
    });
  }

  bath(viewerId: string, id: string) {
    return this.act(viewerId, id, async (m, b) => {
      this.awake(b);
      if (this.meters(b).clean >= CLEAN_AT) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} is already clean`);
      const grown = await this.award(m, b, viewerId, 'baths');
      if (!grown) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} had enough baths from you today`);
      return (await sqlOne<BabyRow>(m, `UPDATE babies SET clean = 100, clean_at = now(), happiness = $2, happiness_at = now()
        WHERE id = $1 RETURNING *`, [b.id, Math.min(100, this.meters(grown).happiness + 5)]))!;
    });
  }

  /** Bedtime: energy fills up while asleep. The first bedtime of the day earns a little. */
  sleep(viewerId: string, id: string) {
    return this.act(viewerId, id, async (m, b) => {
      if (b.asleep_at) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} is already asleep`);
      if (this.meters(b).energy >= RESTED_AT) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} isn't sleepy yet`);
      const tucked = (await sqlOne<BabyRow>(m, 'UPDATE babies SET energy = $2, energy_at = now(), asleep_at = now() WHERE id = $1 RETURNING *',
        [b.id, this.meters(b).energy]))!;
      return (await this.award(m, tucked, viewerId, 'sleeps')) ?? tucked;
    });
  }

  /** Waking a child who hasn't slept enough makes them a bit grumpy. */
  wake(viewerId: string, id: string) {
    return this.act(viewerId, id, async (m, b) => {
      if (!b.asleep_at) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} is already awake`);
      const now = this.meters(b);
      // From now on the meters run down at the awake speed again.
      return (await sqlOne<BabyRow>(m, `UPDATE babies SET energy = $2, energy_at = now(), asleep_at = NULL, happiness = $3, happiness_at = now(),
        fullness = $4, fullness_at = now(), clean = $5, clean_at = now()
        WHERE id = $1 RETURNING *`, [b.id, now.energy, Math.max(0, now.happiness - (now.energy < 50 ? 10 : 0)), now.fullness, now.clean]))!;
    });
  }

  /**
   * A hug cheers the child up (once every few minutes per parent, so tapping Hug again and again
   * doesn't fill the happiness meter); both parents hugging within minutes is a family hug.
   */
  hug(viewerId: string, id: string) {
    return this.act(viewerId, id, async (m, b) => {
      const mine = b.low_id === viewerId ? 'hug_low_at' : 'hug_high_at';
      const myLast = b.low_id === viewerId ? b.hug_low_at : b.hug_high_at;
      const theirs = b.low_id === viewerId ? b.hug_high_at : b.hug_low_at;
      const today = new Date().toISOString().slice(0, 10);
      const family = !!theirs && Date.now() - theirs.getTime() <= FAMILY_HUG_MINUTES * 60_000 && this.dayOf(b.last_hug_day) !== today;
      const fresh = !myLast || Date.now() - myLast.getTime() >= HUG_COOLDOWN_MINUTES * 60_000;
      const happiness = Math.min(100, this.meters(b).happiness + (family ? FAMILY_HUG_HAPPINESS : fresh ? HUG_HAPPINESS : 0));
      if (!family) {
        return (await sqlOne<BabyRow>(m, `UPDATE babies SET ${mine} = now(), happiness = $2, happiness_at = now() WHERE id = $1 RETURNING *`,
          [b.id, happiness]))!;
      }
      const after = (await sqlOne<BabyRow>(m, `UPDATE babies SET ${mine} = now(), happiness = $2, happiness_at = now(),
        xp = xp + $3, coins = coins + $4, last_hug_day = ${TODAY}, family_hugs = family_hugs + 1 WHERE id = $1 RETURNING *`,
      [b.id, happiness, XP.familyHug, COINS.familyHug]))!;
      if (b.family_hugs === 0) await this.remember(m, b.id, 'firsthug', {}, viewerId);
      this.push.notifyUser(b.low_id === viewerId ? b.high_id : b.low_id);
      return this.grew(m, b, after, viewerId);
    });
  }

  /** Getting better comes with warm soup and a wash, so the cold can't come straight back. */
  private async cure(m: Db, b: BabyRow, byId: string | null) {
    const now = this.meters(b);
    const next = (await sqlOne<BabyRow>(m, `UPDATE babies SET sick_since = NULL, medicine_by = '{}', medicine_at = NULL,
      happiness = $2, happiness_at = now(), fullness = $3, fullness_at = now(), clean = $4, clean_at = now()
      WHERE id = $1 AND sick_since IS NOT NULL RETURNING *`,
    [b.id, Math.min(100, now.happiness + 20), Math.max(now.fullness, 40), Math.max(now.clean, 50)])) ?? b;
    if (next !== b) await this.remember(m, b.id, 'healed', {}, byId);
    return next;
  }

  /** One dose from each parent cures a cold right away. */
  medicine(viewerId: string, id: string) {
    return this.act(viewerId, id, async (m, b) => {
      if (!b.sick_since) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} is healthy`);
      if (b.medicine_by.includes(viewerId)) throw AppException.badRequest(ErrorCode.INVALID_STATE, 'You already gave medicine. Now it is the other parent\'s turn');
      const dosed = (await sqlOne<BabyRow>(m, `UPDATE babies SET medicine_by = array_append(medicine_by, $2::uuid),
        medicine_at = coalesce(medicine_at, now()) WHERE id = $1 RETURNING *`, [b.id, viewerId]))!;
      if (dosed.medicine_by.includes(b.low_id) && dosed.medicine_by.includes(b.high_id)) return this.cure(m, dosed, viewerId);
      this.push.notifyUser(b.low_id === viewerId ? b.high_id : b.low_id);
      return dosed;
    });
  }

  /** Spends the shared piggy bank; room decorations go up straight away. */
  buy(viewerId: string, id: string, itemId: string) {
    return this.act(viewerId, id, async (m, b) => {
      const item = SHOP.find((i) => i.id === itemId);
      if (!item) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Unknown item');
      if (b.owned.includes(item.id)) throw AppException.badRequest(ErrorCode.INVALID_STATE, 'You already have this');
      if (b.coins < item.price) throw AppException.badRequest(ErrorCode.INVALID_STATE, 'Not enough coins yet');
      const placed = item.slot ? `, decor = decor || jsonb_build_object('${item.slot}', $3::text)` : '';
      const next = (await sqlOne<BabyRow>(m, `UPDATE babies SET coins = coins - $4, owned = array_append(owned, $3::text)${placed}
        WHERE id = $1 AND coins >= $4 AND NOT ($3::text = ANY(owned)) AND $2::uuid IN (low_id, high_id) RETURNING *`,
      [b.id, viewerId, item.id, item.price]))!;
      if (item.kind === 'decor') await this.remember(m, b.id, 'bought', { item: item.id }, viewerId);
      return next;
    });
  }

  /** Puts an owned decoration in its place, or takes it down. */
  place(viewerId: string, id: string, slot: DecorSlot, itemId: string | null) {
    return this.act(viewerId, id, async (m, b) => {
      if (itemId) {
        const item = SHOP.find((i) => i.id === itemId);
        if (!item || item.slot !== slot) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'That does not go there');
        if (!b.owned.includes(item.id)) throw AppException.badRequest(ErrorCode.INVALID_STATE, 'Buy this in the shop first');
        return (await sqlOne<BabyRow>(m, 'UPDATE babies SET decor = decor || jsonb_build_object($2::text, $3::text) WHERE id = $1 RETURNING *',
          [b.id, slot, item.id]))!;
      }
      return (await sqlOne<BabyRow>(m, 'UPDATE babies SET decor = decor - $2::text WHERE id = $1 RETURNING *', [b.id, slot]))!;
    });
  }

  /** The photo in the frame: any photo the two of you shared in this chat. */
  setPhoto(viewerId: string, id: string, messageId: string | null) {
    return this.act(viewerId, id, async (m, b) => {
      if (!b.owned.includes('frame')) throw AppException.badRequest(ErrorCode.INVALID_STATE, 'Buy the photo frame in the shop first');
      if (messageId) {
        const ok = await sqlOne(m, `SELECT 1 FROM direct_messages d JOIN media md ON md.id = d.media_id
          WHERE d.id = $1 AND least(d.sender_id, d.recipient_id) = $2 AND greatest(d.sender_id, d.recipient_id) = $3
          AND NOT d.view_once AND md.type = 'IMAGE'`, [messageId, b.low_id, b.high_id]);
        if (!ok) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Choose a photo from this chat');
      }
      return (await sqlOne<BabyRow>(m, `UPDATE babies SET photo_message_id = $2,
        decor = CASE WHEN $2::uuid IS NULL THEN decor ELSE decor || '{"frame":"frame"}'::jsonb END WHERE id = $1 RETURNING *`, [b.id, messageId]))!;
    });
  }

  /** A parent teaches a word (toddlers and up, three words a day per parent). */
  teach(viewerId: string, id: string, raw: string) {
    return this.act(viewerId, id, async (m, b) => {
      if (stageOf(b.xp).stage < WORD_STAGE) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} is too little to talk yet`);
      const word = teachableWord(raw);
      if (!word) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Use letters only, up to 20');
      const today = await sqlOne<{ n: number }>(m, `SELECT count(*)::int AS n FROM baby_words WHERE baby_id = $1 AND taught_by = $2
        AND (learned_at AT TIME ZONE 'UTC')::date = ${TODAY}`, [b.id, viewerId]);
      if ((today?.n ?? 0) >= 3) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} learned enough words from you today`);
      if (!(await this.learn(m, b, word, viewerId, false, true))) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} already knows "${word}"`);
      return b;
    });
  }

  /** `taught` marks a word a parent taught on purpose (those count toward the daily three). */
  private async learn(m: Db, b: BabyRow, word: string, byId: string | null, first: boolean, taught = !!byId) {
    const added = await sqlOne(m, `INSERT INTO baby_words(baby_id, word, taught_by, learned_at) VALUES ($1, $2, $3, clock_timestamp())
      ON CONFLICT DO NOTHING RETURNING 1`, [b.id, word.slice(0, 24), taught ? byId : null]);
    if (!added) return false;
    await this.remember(m, b.id, 'word', first ? { word, first: true } : { word }, byId);
    return true;
  }

  /** Words this couple uses for each other: the love words plus their private nicknames. */
  private async candidates(m: Db, b: BabyRow) {
    const nicknames = await sqlRows<{ nickname: string }>(m, `SELECT nickname FROM conversation_prefs
      WHERE ((user_id = $1 AND peer_id = $2) OR (user_id = $2 AND peer_id = $1)) AND nickname IS NOT NULL`, [b.low_id, b.high_id]);
    return [...nicknames.map((n) => n.nickname).filter((n) => n.length <= 24), ...LOVE_WORDS];
  }

  /** A toddler's first word is the love word their parents use most in the chat. */
  private async firstWord(m: Db, b: BabyRow) {
    // Counted here rather than in SQL: a word has to start a word ("anne" isn't in "zannedersem").
    const messages = await sqlRows<{ content: string }>(m, `SELECT content FROM direct_messages WHERE least(sender_id, recipient_id) = $1
      AND greatest(sender_id, recipient_id) = $2 AND content IS NOT NULL ORDER BY created_at DESC LIMIT 3000`, [b.low_id, b.high_id]);
    const top = favoriteWord(messages.map((r) => r.content), await this.candidates(m, b));
    await this.learn(m, b, top ?? FALLBACK_FIRST_WORD, null, true);
    await sqlRows(m, `UPDATE babies SET last_word_day = ${TODAY} WHERE id = $1`, [b.id]);
  }

  /** Every page of the memory book, plus all the words the child knows. */
  async memories(viewerId: string, id: string) {
    const b = await sqlOne<BabyRow>(this.db, 'SELECT id FROM babies WHERE id = $1 AND $2::uuid IN (low_id, high_id)', [id, viewerId]);
    if (!b) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Baby not found');
    const [moments, words] = await Promise.all([
      sqlRows<MomentRow>(this.db, 'SELECT * FROM baby_moments WHERE baby_id = $1 ORDER BY created_at DESC LIMIT 300', [id]),
      sqlRows<{ word: string; taught_by: string | null; learned_at: Date }>(this.db,
        'SELECT word, taught_by, learned_at FROM baby_words WHERE baby_id = $1 ORDER BY learned_at DESC', [id]),
    ]);
    return {
      moments: moments.map((r) => this.moment(r)),
      words: words.map((w) => ({ word: w.word, taughtBy: w.taught_by, learnedAt: iso(w.learned_at)! })),
    };
  }

  /**
   * Check-in while the baby screen is open (every few seconds): says where you are, and returns
   * whether the other parent is here too, where, and any signals they sent since `since`.
   */
  async here(viewerId: string, id: string, scene: Scene, since?: number) {
    const b = await sqlOne<{ low_id: string; high_id: string; at: Date | null; scene: Scene | null }>(this.db, `UPDATE babies SET
        here_low_at = CASE WHEN low_id = $2 THEN now() ELSE here_low_at END,
        here_low_scene = CASE WHEN low_id = $2 THEN $3 ELSE here_low_scene END,
        here_high_at = CASE WHEN high_id = $2 THEN now() ELSE here_high_at END,
        here_high_scene = CASE WHEN high_id = $2 THEN $3 ELSE here_high_scene END
      WHERE id = $1 AND $2::uuid IN (low_id, high_id) AND status = 'active'
      RETURNING low_id, high_id,
        CASE WHEN low_id = $2 THEN here_high_at ELSE here_low_at END AS at,
        CASE WHEN low_id = $2 THEN here_high_scene ELSE here_low_scene END AS scene`, [id, viewerId, scene]);
    if (!b) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Baby not found');
    const partnerHere = !!b.at && Date.now() - b.at.getTime() < HERE_SECONDS * 1000;
    // First check-in: no old signals, just the current position.
    const rows = since === undefined
      ? []
      : await sqlRows<{ id: string; kind: Signal; from_id: string; created_at: Date }>(this.db,
        `SELECT id, kind, from_id, created_at FROM baby_signals WHERE baby_id = $1 AND id > $2 AND from_id <> $3
         AND created_at > now() - interval '2 minutes' ORDER BY id LIMIT 30`, [id, since, viewerId]);
    const last = await sqlOne<{ id: string | null }>(this.db, 'SELECT max(id) AS id FROM baby_signals WHERE baby_id = $1', [id]);
    return {
      partnerHere,
      partnerScene: partnerHere ? b.scene : null,
      signals: rows.map((r) => ({ id: Number(r.id), kind: r.kind, fromId: r.from_id, createdAt: iso(r.created_at)! })),
      cursor: Number(last?.id ?? 0),
    };
  }

  /** A heart, wave, kiss or star for the other parent; old ones are cleaned up as new ones come. */
  async signal(viewerId: string, id: string, kind: Signal) {
    const b = await sqlOne<{ low_id: string; high_id: string; here: Date | null }>(this.db,
      `SELECT low_id, high_id, CASE WHEN low_id = $2 THEN here_high_at ELSE here_low_at END AS here
       FROM babies WHERE id = $1 AND $2::uuid IN (low_id, high_id) AND status = 'active'`, [id, viewerId]);
    if (!b) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Baby not found');
    const recent = await sqlOne<{ n: number }>(this.db, `SELECT count(*)::int AS n FROM baby_signals
      WHERE baby_id = $1 AND from_id = $2 AND created_at > now() - interval '10 seconds'`, [id, viewerId]);
    if ((recent?.n ?? 0) >= 12) throw AppException.badRequest(ErrorCode.INVALID_STATE, 'Slow down a little 💗');
    await sqlRows(this.db, 'INSERT INTO baby_signals(baby_id, from_id, kind) VALUES ($1, $2, $3)', [id, viewerId, kind]);
    await sqlRows(this.db, "DELETE FROM baby_signals WHERE baby_id = $1 AND created_at < now() - interval '1 day'", [id]);
    // Not here: a push brings them over.
    if (!b.here || Date.now() - b.here.getTime() > HERE_SECONDS * 1000) this.push.notifyUser(b.low_id === viewerId ? b.high_id : b.low_id);
  }

  async setOutfit(viewerId: string, id: string, outfit: number) {
    return this.act(viewerId, id, async (m, b) =>
      (await sqlOne<BabyRow>(m, 'UPDATE babies SET outfit = $2 WHERE id = $1 RETURNING *', [b.id, outfit]))!);
  }

  /**
   * Talking to each other keeps your child happy and helps them grow; a toddler picks up the
   * sweet words you use (one new word a day). Never fails a send.
   */
  async onMessage(senderId: string, recipientId: string, text: string | null = null) {
    try {
      const open = await sqlOne<{ id: string }>(this.db, `SELECT id FROM babies WHERE ${PAIR} AND status = 'active'`, [senderId, recipientId]);
      if (!open) return;
      await this.db.transaction(async (m) => {
        const b = await this.lockActive(m, senderId, open.id);
        const grown = await this.award(m, b, senderId, 'chats');
        if (grown) await sqlRows(m, 'UPDATE babies SET happiness = $2, happiness_at = now() WHERE id = $1',
          [b.id, Math.min(100, this.meters(grown).happiness + CHAT_HAPPINESS)]);
        if (!text || stageOf((grown ?? b).xp).stage < WORD_STAGE) return;
        const fresh = await sqlOne(m, `SELECT 1 FROM babies WHERE id = $1 AND last_word_day IS DISTINCT FROM ${TODAY}`, [b.id]);
        if (!fresh) return;
        const known = new Set((await sqlRows<{ word: string }>(m, 'SELECT word FROM baby_words WHERE baby_id = $1', [b.id])).map((w) => w.word));
        const word = wordToLearn(text, await this.candidates(m, b), known);
        // Picked up from a message: remembered as said by the sender, but not counted as taught.
        if (word && (await this.learn(m, b, word, senderId, false, false))) {
          await sqlRows(m, `UPDATE babies SET last_word_day = ${TODAY} WHERE id = $1`, [b.id]);
          this.push.notifyUser(recipientId);
        }
      });
    } catch (error) {
      this.logger.warn({ message: 'Baby chat care not recorded', error: (error as Error).message });
    }
  }

  /** A finished mini game counts for both parents. */
  async onGameFinished(players: string[]) {
    try {
      const [a, b] = players;
      const open = await sqlOne<{ id: string }>(this.db, `SELECT id FROM babies WHERE ${PAIR} AND status = 'active'`, [a, b]);
      if (!open) return;
      await this.db.transaction(async (m) => {
        let row = await this.lockActive(m, a, open.id);
        for (const parent of players) row = (await this.award(m, row, parent, 'games')) ?? row;
      });
    } catch (error) {
      this.logger.warn({ message: 'Baby game care not recorded', error: (error as Error).message });
    }
  }
}
