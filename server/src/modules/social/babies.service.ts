import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { iso } from '../../common/utils/cursor.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { PushService } from './push.service.js';
import {
  CHAT_HAPPINESS,
  DAILY_LIMITS,
  decayed,
  FEED_FULLNESS,
  FULLNESS_HOURS,
  grantedXp,
  HAPPINESS_HOURS,
  moodOf,
  PLAY_HAPPINESS,
  STAGE_NAMES,
  stageOf,
  XP,
  type CareKind,
} from './baby.js';
import type { BabyDto, BabyInviteDto } from './social.dto.js';

type BabyRow = {
  id: string; low_id: string; high_id: string; name: string; gender: 'girl' | 'boy';
  status: 'pending' | 'active' | 'declined' | 'ended'; requested_by: string; born_at: Date | null;
  xp: number; fullness: number; fullness_at: Date; happiness: number; happiness_at: Date; outfit: number;
};
type Db = DataSource | EntityManager;

/** Days follow UTC, like message streaks. */
const TODAY = "(now() AT TIME ZONE 'UTC')::date";
const PAIR = 'low_id = least($1::uuid, $2::uuid) AND high_id = greatest($1::uuid, $2::uuid)';

/** "Our baby": state, daily care and growth of the child a couple raises in their chat. */
@Injectable()
export class BabiesService {
  private readonly logger = new Logger(BabiesService.name);
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly push: PushService,
  ) {}

  invite(b: BabyRow): BabyInviteDto {
    return { id: b.id, name: b.name, gender: b.gender, status: b.status, requestedBy: b.requested_by };
  }

  async invites(ids: string[]) {
    if (!ids.length) return new Map<string, BabyInviteDto>();
    const rows = await sqlRows<BabyRow>(this.db, 'SELECT * FROM babies WHERE id = ANY($1::uuid[])', [ids]);
    return new Map(rows.map((b) => [b.id, this.invite(b)]));
  }

  async dto(m: Db, b: BabyRow, viewerId: string): Promise<BabyDto> {
    const care = await sqlRows<{ user_id: string; feeds: number; plays: number; chats: number; games: number }>(
      m, `SELECT user_id, feeds, plays, chats, games FROM baby_care WHERE baby_id = $1 AND day = ${TODAY}`, [b.id]);
    const of = (userId: string) => {
      const r = care.find((c) => c.user_id === userId);
      return { feeds: r?.feeds ?? 0, plays: r?.plays ?? 0, chats: r?.chats ?? 0, games: r?.games ?? 0 };
    };
    const fullness = decayed(b.fullness, b.fullness_at, FULLNESS_HOURS);
    const happiness = decayed(b.happiness, b.happiness_at, HAPPINESS_HOURS);
    const stage = stageOf(b.xp);
    return {
      ...this.invite(b),
      bornAt: iso(b.born_at),
      ageDays: b.born_at ? Math.floor((Date.now() - b.born_at.getTime()) / 86_400_000) : 0,
      xp: b.xp,
      ...stage,
      stageName: STAGE_NAMES[stage.stage - 1],
      fullness,
      happiness,
      mood: moodOf(fullness, happiness),
      outfit: b.outfit,
      mine: of(viewerId),
      theirs: of(b.low_id === viewerId ? b.high_id : b.low_id),
      limits: { ...DAILY_LIMITS },
    };
  }

  /** The open request or the child of this couple, if any. */
  async current(viewerId: string, peerId: string) {
    const b = await sqlOne<BabyRow>(this.db, `SELECT * FROM babies WHERE ${PAIR} AND status IN ('pending','active')`, [viewerId, peerId]);
    return { baby: b ? await this.dto(this.db, b, viewerId) : null };
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
    return b;
  }

  /** The other parent says yes: the baby is born. */
  async accept(viewerId: string, id: string) {
    const b = await this.db.transaction(async (m) => {
      const b = await this.lock(m, viewerId, id);
      if (b.status !== 'pending') throw AppException.badRequest(ErrorCode.INVALID_STATE, 'This request is no longer open');
      if (b.requested_by === viewerId) throw AppException.forbidden(ErrorCode.INVALID_STATE, 'Wait for the other parent to accept');
      return (await sqlOne<BabyRow>(m, `UPDATE babies SET status = 'active', born_at = now(), fullness = 80, fullness_at = now(),
        happiness = 90, happiness_at = now() WHERE id = $1 RETURNING *`, [id]))!;
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

  /**
   * Counts one care action of `userId` today, within the daily limit, and adds its XP (plus a
   * bonus the first time both parents cared on the same day). Returns false over the limit.
   */
  private async award(m: Db, b: BabyRow, userId: string, kind: CareKind): Promise<BabyRow | null> {
    const xp = grantedXp(kind, decayed(b.fullness, b.fullness_at, FULLNESS_HOURS));
    const counted = await sqlOne(m, `INSERT INTO baby_care(baby_id, user_id, day, ${kind}, xp) VALUES ($1, $2, ${TODAY}, 1, $3)
      ON CONFLICT (baby_id, user_id, day) DO UPDATE SET ${kind} = baby_care.${kind} + 1, xp = baby_care.xp + EXCLUDED.xp
      WHERE baby_care.${kind} < $4 RETURNING 1`, [b.id, userId, xp, DAILY_LIMITS[kind]]);
    if (!counted) return null;
    return (await sqlOne<BabyRow>(m, `WITH both_parents AS (
        SELECT count(*) = 2 AS ok FROM baby_care WHERE baby_id = $1 AND day = ${TODAY} AND xp > 0)
      UPDATE babies b SET
        xp = b.xp + $2 + CASE WHEN both_parents.ok AND b.last_bonus_day IS DISTINCT FROM ${TODAY} THEN $3 ELSE 0 END,
        last_bonus_day = CASE WHEN both_parents.ok THEN ${TODAY} ELSE b.last_bonus_day END
      FROM both_parents WHERE b.id = $1 RETURNING b.*`, [b.id, xp, XP.bothBonus]))!;
  }

  async feed(viewerId: string, id: string) {
    const b = await this.db.transaction(async (m) => {
      const b = await this.lockActive(m, viewerId, id);
      // Feed first, so a hungry child's meal counts at full speed.
      const fed = (await sqlOne<BabyRow>(m, `UPDATE babies SET fullness = $2, fullness_at = now(), happiness = $3, happiness_at = now()
        WHERE id = $1 RETURNING *`, [id, Math.min(100, decayed(b.fullness, b.fullness_at, FULLNESS_HOURS) + FEED_FULLNESS),
        Math.min(100, decayed(b.happiness, b.happiness_at, HAPPINESS_HOURS) + 5)]))!;
      const grown = await this.award(m, fed, viewerId, 'feeds');
      if (!grown) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} has eaten enough from you today`);
      return grown;
    });
    return this.dto(this.db, b, viewerId);
  }

  async play(viewerId: string, id: string) {
    const b = await this.db.transaction(async (m) => {
      const b = await this.lockActive(m, viewerId, id);
      const grown = await this.award(m, b, viewerId, 'plays');
      if (!grown) throw AppException.badRequest(ErrorCode.INVALID_STATE, `${b.name} is tired of playing with you today`);
      return (await sqlOne<BabyRow>(m, 'UPDATE babies SET happiness = $2, happiness_at = now() WHERE id = $1 RETURNING *',
        [id, Math.min(100, decayed(grown.happiness, grown.happiness_at, HAPPINESS_HOURS) + PLAY_HAPPINESS)]))!;
    });
    return this.dto(this.db, b, viewerId);
  }

  async setOutfit(viewerId: string, id: string, outfit: number) {
    const b = await this.db.transaction(async (m) => {
      await this.lockActive(m, viewerId, id);
      return (await sqlOne<BabyRow>(m, 'UPDATE babies SET outfit = $2 WHERE id = $1 RETURNING *', [id, outfit]))!;
    });
    return this.dto(this.db, b, viewerId);
  }

  /** Talking to each other keeps your child happy and helps them grow. Never fails a send. */
  async onMessage(senderId: string, recipientId: string) {
    try {
      const open = await sqlOne<{ id: string }>(this.db, `SELECT id FROM babies WHERE ${PAIR} AND status = 'active'`, [senderId, recipientId]);
      if (!open) return;
      await this.db.transaction(async (m) => {
        const b = await this.lockActive(m, senderId, open.id);
        const grown = await this.award(m, b, senderId, 'chats');
        if (grown) await sqlRows(m, 'UPDATE babies SET happiness = $2, happiness_at = now() WHERE id = $1',
          [b.id, Math.min(100, decayed(grown.happiness, grown.happiness_at, HAPPINESS_HOURS) + CHAT_HAPPINESS)]);
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
