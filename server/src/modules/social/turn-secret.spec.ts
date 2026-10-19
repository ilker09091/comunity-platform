import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTurnSecret } from './turn-secret.js';

describe('persistent TURN key', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'circle-turn-')); });
  afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
  it('generates once and preserves the key across API rebuilds/restarts', () => {
    const file = join(directory, 'control', 'key');
    const first = resolveTurnSecret(undefined, file);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(resolveTurnSecret('', file)).toBe(first);
    expect(readFileSync(file, 'utf8').trim()).toBe(first);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o644);
  });
  it('shares an explicitly configured key and supports explicit rotation', () => {
    const file = join(directory, 'key');
    expect(resolveTurnSecret('first-custom-secret', file)).toBe('first-custom-secret');
    expect(resolveTurnSecret('second-custom-secret', file)).toBe('second-custom-secret');
    expect(readFileSync(file, 'utf8').trim()).toBe('second-custom-secret');
  });
  it('keeps non-Docker deployments optional and does not write files without a path', () => {
    expect(resolveTurnSecret()).toBeUndefined();
    expect(resolveTurnSecret('external-relay-key')).toBe('external-relay-key');
  });
});
