import { MediaUrlService } from './media-url.service.js';

const config = (publicUrl: string | null) =>
  ({
    publicBaseUrl: 'https://api.example.com',
    apiPrefix: 'api',
    media: { urlTtlSeconds: 3600, urlSecret: 'test-secret', publicUrl },
  }) as unknown as ConstructorParameters<typeof MediaUrlService>[0];

describe('MediaUrlService', () => {
  const key = '0123456789abcdef0123456789abcdef.mp4';

  it('serves media through the website when MEDIA_PUBLIC_URL is set (Docker default)', () => {
    const urls = new MediaUrlService(config('/api/backend'));
    const url = urls.url(key);
    expect(url).toMatch(/^\/api\/backend\/api\/media\/files\/0123456789abcdef0123456789abcdef\.mp4\?exp=\d+&sig=/);
    const parsed = new URL(url, 'https://rosefly.store');
    expect(urls.verify(key, Number(parsed.searchParams.get('exp')), parsed.searchParams.get('sig')!)).toBe(true);
  });

  it('falls back to PUBLIC_BASE_URL', () => {
    expect(new MediaUrlService(config(null)).url(key)).toMatch(/^https:\/\/api\.example\.com\/api\/media\/files\//);
  });
});
