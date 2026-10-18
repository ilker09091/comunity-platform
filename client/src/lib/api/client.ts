import type { components, operations } from "./schema";
import { endpoints } from "./operations";

export type Models = components["schemas"];
export type Post = Models["PostDto"];
export type User = Models["UserSummaryDto"];
type Responses<K extends keyof operations> = operations[K] extends {
  responses: infer R;
}
  ? R
  : never;
type Success<K extends keyof operations> = Responses<K>[Extract<
  keyof Responses<K>,
  200 | 201 | 204
>];
type UpstreamResult<K extends keyof operations> =
  Success<K> extends { content: { "application/json": infer T } } ? T : void;
export type Result<K extends keyof operations> = K extends
  "authLogin" | "authRegister"
  ? Pick<Models["AuthResponseDto"], "user">
  : UpstreamResult<K>;
type Body<K extends keyof operations> = operations[K] extends {
  requestBody: { content: { "application/json": infer B } };
}
  ? B
  : never;
type RequestBody<K extends keyof operations> = Body<K>;
export type Options<K extends keyof operations> = {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: RequestBody<K> | FormData;
  signal?: AbortSignal;
  keepalive?: boolean;
  headers?: Record<string, string>;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: { field: string; message: string }[] = [],
    public retryAfter?: number,
  ) {
    super(message);
  }
}
const rateLimits = new Map<string, number>();
function enforceRateLimit(url: string) {
  const until = rateLimits.get(url.split("?")[0]) ?? 0;
  const remaining = Math.ceil((until - Date.now()) / 1000);
  if (remaining > 0)
    throw new ApiError(
      429,
      "RATE_LIMITED",
      `Please try again in ${remaining} seconds.`,
      [],
      remaining,
    );
}
function recordRateLimit(url: string, value: string | null) {
  const seconds = Number(value);
  const until =
    Number.isFinite(seconds) && seconds > 0
      ? Date.now() + seconds * 1000
      : value
        ? Date.parse(value)
        : NaN;
  if (Number.isFinite(until)) rateLimits.set(url.split("?")[0], until);
}
export function operationUrl<K extends keyof operations>(
  name: K,
  options: Options<K> = {},
) {
  let path: string = endpoints[name].path;
  for (const [key, value] of Object.entries(options.params ?? {}))
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  if (path.includes("{")) throw new Error(`Missing path parameter for ${name}`);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {}))
    if (value !== undefined) query.set(key, String(value));
  return "/api/backend" + path + (query.size ? "?" + query : "");
}
export async function api<K extends keyof operations>(
  name: K,
  options: Options<K> = {},
): Promise<Result<K>> {
  const form = options.body instanceof FormData;
  const url = operationUrl(name, options);
  enforceRateLimit(url);
  const response = await fetch(url, {
    method: endpoints[name].method,
    credentials: "same-origin",
    signal: options.signal,
    keepalive: options.keepalive,
    headers: {
      "X-Social-Client": "web",
      ...options.headers,
      ...(options.body && !form ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body
      ? form
        ? (options.body as FormData)
        : JSON.stringify(options.body)
      : undefined,
  });
  if (!response.ok) {
    if (response.status === 429)
      recordRateLimit(url, response.headers.get("Retry-After"));
    const error = await response.json().catch(() => ({}));
    if (
      response.status === 401 &&
      !["authLogin", "authRegister"].includes(name)
    )
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      response.status,
      error.code ?? "NETWORK_ERROR",
      error.message ?? "Unable to complete this request.",
      error.details,
      Number(response.headers.get("Retry-After")) || undefined,
    );
  }
  return response.status === 204 ? (undefined as Result<K>) : response.json();
}
/** Readable message when a proxy/CDN answers with an HTML page instead of the API's JSON. */
function nonJsonUploadError(status: number) {
  if (status === 413)
    return new ApiError(413, "FILE_TOO_LARGE", "This file is larger than the server accepts in one request.");
  if (status === 0) return new ApiError(0, "NETWORK_ERROR", "Upload failed. Check your connection and try again.");
  return new ApiError(status, "UPLOAD_FAILED", `Upload failed (server responded ${status}). Please try again.`);
}

const MIN_CHUNK = 256 * 1024;
const CHUNK_KEY = "upload-chunk-bytes";
/** Largest piece the server path accepted after a 413, remembered so later uploads start there. */
function rememberedChunk(): number | null {
  try {
    const value = Number(localStorage.getItem(CHUNK_KEY));
    return value >= MIN_CHUNK ? value : null;
  } catch {
    return null;
  }
}
function rememberChunk(bytes: number) {
  try {
    localStorage.setItem(CHUNK_KEY, String(bytes));
  } catch {
    /* private mode */
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Large files (phone videos) go up in pieces: no single request can hit a reverse proxy's body
 * limit (a 413 halves the piece size), a dropped connection retries just one piece, and the
 * server's `received` offset is the source of truth for resuming.
 */
async function chunkedUpload(file: File, onProgress: (percent: number) => void): Promise<Models["MediaDto"]>;
async function chunkedUpload(
  file: File,
  onProgress: (percent: number) => void,
  finish: "mediaUploadsCompleteAudio",
): Promise<Models["AudioUploadDto"]>;
async function chunkedUpload(
  file: File,
  onProgress: (percent: number) => void,
  finish: "mediaUploadsComplete" | "mediaUploadsCompleteAudio" = "mediaUploadsComplete",
): Promise<Models["MediaDto"] | Models["AudioUploadDto"]> {
  const session = await api("mediaUploadsStart", { body: { size: file.size, fileName: file.name || "upload" } });
  let offset = session.received;
  let size = Math.min(session.chunkSize, rememberedChunk() ?? session.chunkSize);
  let shrunk = false;
  let failures = 0;
  while (offset < file.size) {
    const url = operationUrl("mediaUploadsChunk", { params: { id: session.id }, query: { offset } });
    enforceRateLimit(url);
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Social-Client": "web", "Content-Type": "application/octet-stream" },
      body: file.slice(offset, offset + size),
    }).catch(() => null);
    if (response?.ok) {
      if (shrunk) {
        rememberChunk(size);
        shrunk = false;
      }
      offset = (await response.json()).received;
      failures = 0;
      onProgress(Math.min(99, Math.round((offset / file.size) * 100)));
      continue;
    }
    if (response?.status === 413 && size > MIN_CHUNK) {
      size = Math.max(MIN_CHUNK, Math.floor(size / 2));
      shrunk = true;
      continue;
    }
    if (response?.status === 413)
      throw new ApiError(413, "FILE_TOO_LARGE", "The server rejects even very small upload pieces. Its upload limit (reverse proxy) needs to be raised.");
    if (response?.status === 401) window.dispatchEvent(new Event("session-expired"));
    const retryable = !response || response.status >= 500 || response.status === 408 || response.status === 409 || response.status === 429;
    if (!retryable || ++failures > 6) {
      const error = response ? await response.json().catch(() => null) : null;
      throw error?.code
        ? new ApiError(response!.status, error.code, error.message ?? "Upload failed.", error.details)
        : nonJsonUploadError(response?.status ?? 0);
    }
    if (response?.status === 429) recordRateLimit(url, response.headers.get("Retry-After"));
    await sleep(Math.min(8000, 700 * failures));
    // Re-sync with what the server actually stored before retrying.
    offset = (await api("mediaUploadsStatus", { params: { id: session.id } })).received;
  }
  onProgress(100);
  return finish === "mediaUploadsCompleteAudio"
    ? api("mediaUploadsCompleteAudio", { params: { id: session.id } })
    : api("mediaUploadsComplete", { params: { id: session.id } });
}

/** Uploads a sound clip in pieces (never hits a proxy's body limit) for "Add sound" on Reels. */
export async function uploadAudio(file: File, onProgress: (percent: number) => void = () => {}) {
  await api("usersGetMe");
  return chunkedUpload(file, onProgress, "mediaUploadsCompleteAudio");
}

/**
 * Uploads any file (post media, Reels, avatar, cover). Everything goes up in pieces through
 * /media/uploads, whatever its size: a reverse proxy with a small body limit (nginx defaults to
 * 1 MB) can never reject the upload, and a dropped connection only resends one piece.
 */
export async function upload(
  file: File,
  onProgress: (percent: number) => void,
  kind: "mediaUpload" | "usersSetAvatar" | "usersSetCover" = "mediaUpload",
): Promise<Models["MediaDto"] | Models["MeDto"]> {
  // Prime/refresh the session before sending a potentially large, non-replayable upload.
  await api("usersGetMe");
  const media = await chunkedUpload(file, onProgress);
  if (kind === "mediaUpload") return media;
  return api(kind === "usersSetAvatar" ? "usersSetAvatarMedia" : "usersSetCoverMedia", { body: { mediaId: media.id } });
}
