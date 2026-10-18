import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppException, ErrorCode } from '../../common/errors/app.exception.js';
import { sqlOne, sqlRows } from '../../common/utils/sql.js';
import { PushSubscriptionDto } from './social.dto.js';

const b64url = (data: Buffer) => data.toString('base64url');

/**
 * Web Push without third-party libraries. Pushes carry no payload (so nothing needs encrypting):
 * the service worker wakes up, fetches the latest message itself and shows the notification.
 * Requests are authenticated with VAPID (RFC 8292). The key pair comes from VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY (PEM) when set, otherwise it is generated once and kept in the database.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private keys: { publicKey: string; privatePem: string } | null = null;

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async onModuleInit() {
    try {
      await this.loadKeys();
    } catch (error) {
      this.logger.warn({ message: 'Push keys unavailable', error: (error as Error).message });
    }
  }

  private async loadKeys() {
    if (this.keys) return this.keys;
    const envPrivate = process.env.VAPID_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (envPrivate) {
      this.keys = { privatePem: envPrivate, publicKey: this.rawPublic(envPrivate) };
      return this.keys;
    }
    let row = await sqlOne<{ public_key: string; private_key: string }>(
      this.db,
      'SELECT public_key, private_key FROM push_vapid_keys WHERE id = 1',
    );
    if (!row) {
      const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      await sqlRows(
        this.db,
        'INSERT INTO push_vapid_keys(id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING',
        [this.rawPublic(privatePem), privatePem],
      );
      row = await sqlOne(this.db, 'SELECT public_key, private_key FROM push_vapid_keys WHERE id = 1');
    }
    this.keys = { publicKey: row!.public_key, privatePem: row!.private_key };
    return this.keys;
  }

  /** Uncompressed P-256 point (65 bytes), base64url — the browser's `applicationServerKey`. */
  private rawPublic(privatePem: string) {
    const jwk = createPublicKey(privatePem).export({ format: 'jwk' });
    return b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]));
  }

  async publicKey() {
    return (await this.loadKeys()).publicKey;
  }

  async subscribe(userId: string, dto: PushSubscriptionDto) {
    let url: URL;
    try {
      url = new URL(dto.endpoint);
    } catch {
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Invalid push endpoint');
    }
    // Push services are always https (plain http is only accepted by the e2e tests' fake service).
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && url.hostname === '127.0.0.1')) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Invalid push endpoint');
    // An endpoint belongs to one browser: whoever signed in last on it receives its pushes.
    await sqlRows(
      this.db,
      `INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
      ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [userId, dto.endpoint, dto.p256dh ?? null, dto.auth ?? null],
    );
  }

  async unsubscribe(userId: string, endpoint: string) {
    await sqlRows(this.db, 'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
  }

  /** Wakes every device of `userId` (fire and forget; never throws). */
  notifyUser(userId: string, topic = 'messages') {
    void this.send(userId, topic).catch((error) =>
      this.logger.warn({ message: 'Push failed', error: (error as Error).message }),
    );
  }

  /** Sends to every device of `userId`; returns how many accepted the push. */
  async send(userId: string, topic = 'messages'): Promise<number> {
    const subs = await sqlRows<{ id: string; endpoint: string }>(
      this.db,
      'SELECT id, endpoint FROM push_subscriptions WHERE user_id = $1',
      [userId],
    );
    if (!subs.length) return 0;
    const keys = await this.loadKeys();
    let delivered = 0;
    await Promise.all(
      subs.map(async (sub) => {
        const audience = new URL(sub.endpoint).origin;
        const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
        const claims = b64url(
          Buffer.from(
            JSON.stringify({
              aud: audience,
              exp: Math.floor(Date.now() / 1000) + 12 * 3600,
              sub: process.env.VAPID_SUBJECT || 'mailto:support@rosefly.store',
            }),
          ),
        );
        const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
          key: keys.privatePem,
          dsaEncoding: 'ieee-p1363',
        });
        const response = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`,
            TTL: String(24 * 3600),
            Urgency: 'high',
            Topic: topic,
            'Content-Length': '0',
          },
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null);
        if (!response) return;
        if (response.status === 404 || response.status === 410) {
          // The browser unsubscribed or the subscription expired.
          await sqlRows(this.db, 'DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
          return;
        }
        if (response.ok) {
          delivered++;
          await sqlRows(this.db, 'UPDATE push_subscriptions SET last_success_at = now() WHERE id = $1', [sub.id]);
        } else {
          this.logger.warn({ message: 'Push rejected', status: response.status, origin: audience });
        }
      }),
    );
    return delivered;
  }
}
