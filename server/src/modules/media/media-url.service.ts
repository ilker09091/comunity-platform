import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { appConfig } from '../../config/app.config.js';

export const STORAGE_KEY_RE = /^[a-f0-9]{32}\.(jpg|png|webp|gif|mp4|webm|mov|m4a)$/;

/**
 * Builds HMAC-signed, expiring media URLs. URLs are only handed out in responses the viewer
 * is authorised to see, so possession of a valid URL is the access check.
 * Expiry is bucketed so a URL stays stable (cacheable) for a full TTL window.
 */
@Injectable()
export class MediaUrlService {
  constructor(@Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>) {}

  url(storageKey: string): string;
  url(storageKey: string | null): string | null;
  url(storageKey: string | null): string | null {
    if (!storageKey) return null;
    const ttl = this.config.media.urlTtlSeconds;
    const now = Math.floor(Date.now() / 1000);
    const exp = (Math.floor(now / ttl) + 2) * ttl;
    const sig = this.sign(storageKey, exp);
    const { publicBaseUrl, apiPrefix } = this.config;
    const base = this.config.media.publicUrl ?? publicBaseUrl;
    return `${base}/${apiPrefix}/media/files/${storageKey}?exp=${exp}&sig=${sig}`;
  }

  verify(storageKey: string, exp: number, sig: string): boolean {
    if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(this.sign(storageKey, exp));
    const actual = Buffer.from(sig);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private sign(storageKey: string, exp: number): string {
    return createHmac('sha256', this.config.media.urlSecret)
      .update(`${storageKey}:${exp}`)
      .digest('base64url')
      .slice(0, 43);
  }
}
