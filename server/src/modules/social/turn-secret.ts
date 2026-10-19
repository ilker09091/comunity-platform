import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, linkSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

/** One persistent key for the API and its read-only Coturn volume mount. */
export function resolveTurnSecret(secret?: string, file?: string): string | undefined {
  const configured = secret?.trim();
  if (!file) return configured || undefined;
  mkdirSync(dirname(file), { recursive: true });
  let existing: string | undefined;
  try { existing = readFileSync(file, 'utf8').trim(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (existing && (!configured || configured === existing)) return existing;
  const value = configured || randomBytes(32).toString('hex');
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${value}\n`, { mode: 0o644 });
  if (existing === undefined && !configured) {
    try { linkSync(temporary, file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    finally { unlinkSync(temporary); }
    return readFileSync(file, 'utf8').trim();
  }
  renameSync(temporary, file);
  return value;
}
