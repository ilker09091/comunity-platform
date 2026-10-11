import { access, constants, copyFile, mkdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export type StoredObject =
  | { kind: 'file'; path: string }
  | { kind: 'redirect'; url: string };

/**
 * Storage abstraction for media binaries. Production object storage (S3, GCS, R2…) can be
 * added by implementing this interface and selecting it via MEDIA_STORAGE_DRIVER.
 */
export interface StorageDriver {
  readonly name: string;
  /** Stores a buffer or copies a local file under `key`. */
  put(key: string, source: Buffer | { filePath: string }, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Resolves a stored object for delivery, or null when it does not exist. */
  resolve(key: string): Promise<StoredObject | null>;
  /** Existence and size of a stored object (null size when the backend cannot report it). */
  stat(key: string): Promise<{ exists: boolean; size: number | null }>;
  /** Connectivity / capacity check for System Status. */
  health(): Promise<{ writable: boolean; freeBytes: number | null; totalBytes: number | null; detail: string | null }>;
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/** Development driver: stores objects on the local filesystem, sharded by key prefix. */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  private pathFor(key: string): string {
    const path = resolve(this.root, key.slice(0, 2), key);
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return path;
  }

  async put(key: string, source: Buffer | { filePath: string }): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    if (Buffer.isBuffer(source)) await writeFile(path, source, { flag: 'wx' });
    else await copyFile(source.filePath, path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async stat(key: string): Promise<{ exists: boolean; size: number | null }> {
    try {
      const info = await stat(this.pathFor(key));
      return { exists: true, size: info.size };
    } catch {
      return { exists: false, size: null };
    }
  }

  async health() {
    try {
      await mkdir(this.root, { recursive: true });
      await access(this.root, constants.W_OK);
      const fs = await statfs(this.root);
      return { writable: true, freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize, detail: null };
    } catch (error) {
      return { writable: false, freeBytes: null, totalBytes: null, detail: (error as Error).message.slice(0, 200) };
    }
  }

  async resolve(key: string): Promise<StoredObject | null> {
    const path = this.pathFor(key);
    try {
      await stat(path);
      return { kind: 'file', path };
    } catch {
      return null;
    }
  }
}
