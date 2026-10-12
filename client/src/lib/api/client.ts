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
export async function upload(
  file: File,
  onProgress: (percent: number) => void,
  kind: "mediaUpload" | "usersSetAvatar" | "usersSetCover" = "mediaUpload",
): Promise<Models["MediaDto"] | Models["MeDto"]> {
  // Prime/refresh the session before sending a potentially large, non-replayable upload.
  await api("usersGetMe");
  const url = operationUrl(kind);
  enforceRateLimit(url);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    // Large videos can take a long time on slow connections (they are compressed after upload).
    xhr.timeout = file.type.startsWith("image/") ? 120000 : 60 * 60 * 1000;
    xhr.setRequestHeader("X-Social-Client", "web");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () =>
      reject(
        new ApiError(
          0,
          "NETWORK_ERROR",
          "Upload failed. Check your connection and try again.",
        ),
      );
    xhr.ontimeout = () =>
      reject(
        new ApiError(
          0,
          "NETWORK_ERROR",
          "The upload timed out. Please try again.",
        ),
      );
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("Invalid upload response."));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 429)
          recordRateLimit(url, xhr.getResponseHeader("Retry-After"));
        if (xhr.status === 401)
          window.dispatchEvent(new Event("session-expired"));
        reject(
          new ApiError(
            xhr.status,
            data.code,
            data.message ?? "Upload failed.",
            data.details,
          ),
        );
      }
    };
    const body = new FormData();
    body.set("file", file);
    xhr.send(body);
  });
}
