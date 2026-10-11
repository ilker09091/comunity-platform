import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import ts from "typescript";

// Contract fixtures live only in this test process. No production seed data or
// backend source/database changes are needed to verify the frontend gateway.
const root = fileURLToPath(new URL("../", import.meta.url));
const spec = JSON.parse(
  await readFile(
    new URL("../../docs/api/openapi.json", import.meta.url),
    "utf8",
  ),
);
const requests = [];
let refreshCount = 0;
let refreshFailure = false;
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "frontend_test",
  displayName: "Frontend Test",
};
const auth = (suffix) => ({
  user,
  tokenType: "Bearer",
  accessToken: `access-${suffix}`,
  refreshToken: `refresh-${suffix}`,
  accessTokenExpiresAt: new Date(Date.now() + 600000).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
});
const upstream = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const url = new URL(request.url, "http://upstream");
  requests.push({
    method: request.method,
    path: url.pathname,
    search: url.search,
    authorization: request.headers.authorization,
    contentType: request.headers["content-type"],
    raw,
  });
  const json = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (
    url.pathname === "/api/auth/login" ||
    url.pathname === "/api/auth/register"
  )
    return json(url.pathname.endsWith("register") ? 201 : 200, auth("login"));
  if (url.pathname === "/api/auth/refresh") {
    refreshCount++;
    const { refreshToken } = JSON.parse(raw);
    if (refreshFailure)
      return json(503, { code: "INTERNAL_ERROR", message: "Offline" });
    if (refreshToken === "invalid")
      return json(401, { code: "INVALID_REFRESH_TOKEN" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    return json(200, auth("rotated-" + refreshCount));
  }
  if (request.headers.authorization === "Bearer expired")
    return json(401, { code: "INVALID_TOKEN", message: "Expired" });
  if (
    url.pathname === "/api/auth/logout" ||
    url.pathname === "/api/auth/logout-all"
  ) {
    response.writeHead(204);
    return response.end();
  }
  if (url.pathname === "/api/users/me")
    return request.headers.authorization
      ? json(200, user)
      : json(401, { code: "UNAUTHORIZED", message: "Sign in" });
  if (url.pathname === "/api/media")
    return json(201, { id: "media-id", status: "READY" });
  if (url.pathname === "/api/posts" && request.method === "POST")
    return json(201, { id: "post-id", ...JSON.parse(raw) });
  if (url.pathname.includes("/like"))
    return json(200, {
      id: "post-id",
      liked: request.method === "POST",
      likeCount: request.method === "POST" ? 1 : 0,
    });
  if (url.searchParams.get("q") === "rate-limit") {
    response.setHeader("Retry-After", "19");
    return json(429, { code: "RATE_LIMITED", message: "Try again later" });
  }
  return json(200, { items: [], nextCursor: null, hasMore: false });
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const upstreamPort = upstream.address().port;
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const next = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      API_ORIGIN: `http://127.0.0.1:${upstreamPort}`,
      SESSION_COOKIE_SECURE: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let output = "";
next.stdout.on("data", (chunk) => {
  output += chunk;
});
next.stderr.on("data", (chunk) => {
  output += chunk;
});
const exit = once(next, "exit");
let temp;
let checks = 0;
const passed = (message) => {
  checks++;
  console.log(`PASS ${message}`);
};
const call = (path, options = {}) =>
  fetch(base + "/api/backend" + path, {
    ...options,
    headers: {
      "X-Social-Client": "web",
      ...(options.body && typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
const cookies = (response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(base + "/login");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    if (next.exitCode !== null) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, output || "Next server failed to start");
  for (const route of [
    "/",
    "/explore",
    "/following",
    "/saved",
    "/notifications",
    "/settings",
    "/login",
    "/register",
    "/post/11111111-1111-4111-8111-111111111111",
    "/profile/frontend_test",
    "/profile/edit",
    "/reels",
  ]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), /Circle|circle/);
  }
  passed("all 12 page routes, including profile editing and Reels, render in the production server");
  for (const route of ["/login", "/register"]) {
    const html = await (await fetch(base + route)).text();
    assert.match(html, /circle-logo/);
    assert.match(html, /aria-label="Circle home"/);
  }
  for (const route of ["/circle-logo.png", "/icon.png", "/favicon.ico"]) {
    const asset = await fetch(base + route);
    assert.equal(asset.status, 200, route);
    assert.match(asset.headers.get("content-type"), /image/);
  }
  const optimizedLogo = await fetch(base + "/_next/image?url=%2Fcircle-logo.png&w=96&q=75", {headers:{Accept:"image/webp"}});
  assert.equal(optimizedLogo.status,200);
  assert.match(optimizedLogo.headers.get("content-type"),/image\/webp/);
  passed("official logo renders on auth pages; logo, icon, favicon and optimized high-density image serve successfully");
  const deepLink = await fetch(base + "/reels?start=11111111-1111-4111-8111-111111111111&media=22222222-2222-4222-8222-222222222222");
  assert.equal(deepLink.status,200);
  passed("the exact post/media Reels URL serves directly in the production server");
  let response = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      identifier: "frontend_test",
      password: "test-only-42",
    }),
    headers: { Origin: base },
  });
  assert.equal(response.status, 200);
  const login = await response.json();
  assert.deepEqual(Object.keys(login), ["user"]);
  for (const cookie of response.headers.getSetCookie()) {
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
    assert.match(cookie, /Path=\/api\/backend/i);
  }
  assert.equal(response.headers.get("cache-control"), "no-store");
  const loginCookies = cookies(response);
  passed("login hides both tokens and sets scoped HttpOnly cookies");
  response = await call("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: "frontend_test",
      email: "test@example.invalid",
      password: "test-only-42",
    }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(await response.json()), ["user"]);
  passed("registration preserves the contract status and hides tokens");
  response = await call("/api/users/me", { headers: { Cookie: loginCookies } });
  assert.equal(response.status, 200);
  assert.equal(requests.at(-1).authorization, "Bearer access-login");
  passed("session restoration forwards the access token server-side");
  const beforeRefresh = refreshCount;
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, () =>
      call("/api/feed/global", {
        headers: { Cookie: "social_refresh=concurrent-test" },
      }),
    ),
  );
  for (const item of concurrent) assert.equal(item.status, 200);
  assert.equal(refreshCount - beforeRefresh, 1);
  assert.equal(new Set(concurrent.map(cookies)).size, 1);
  passed("six concurrent requests share a single refresh-token rotation");
  response = await call("/api/feed/global", {
    headers: { Cookie: "social_access=expired; social_refresh=expired-test" },
  });
  assert.equal(response.status, 200);
  assert.match(cookies(response), /access-rotated/);
  passed(
    "expired Bearer token refreshes once and retries the original request",
  );
  response = await call("/api/feed/global", {
    headers: { Cookie: "social_refresh=invalid" },
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "INVALID_REFRESH_TOKEN");
  assert.ok(
    response.headers
      .getSetCookie()
      .every((cookie) => /Max-Age=0/i.test(cookie)),
  );
  passed(
    "expired refresh tokens clear the session and return a truthful error",
  );
  refreshFailure = true;
  response = await call("/api/feed/global", {
    headers: { Cookie: "social_refresh=temporary-outage" },
  });
  assert.equal(response.status, 502);
  assert.equal(response.headers.getSetCookie().length, 0);
  refreshFailure = false;
  passed("temporary refresh outages preserve the session for retry");
  const previousRequests = requests.length;
  response = await call("/api/posts", {
    method: "POST",
    body: "{}",
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(response.status, 403);
  assert.equal(requests.length, previousRequests);
  response = await fetch(base + "/api/backend/api/posts", {
    method: "POST",
    body: "{}",
  });
  assert.equal(response.status, 403);
  passed(
    "cross-origin and unmarked writes are rejected before reaching the API",
  );
  for (const path of [
    "/api/not-a-real-endpoint",
    "/api/auth/refresh",
    "/api/media/files/key",
  ])
    assert.equal((await call(path)).status, 404);
  assert.equal(requests.length, previousRequests);
  passed("undocumented endpoints and direct refresh forwarding are rejected");
  response = await call("/api/posts", {
    method: "POST",
    headers: { Cookie: loginCookies },
    body: JSON.stringify({
      content: "A real plain-text payload",
      mediaIds: [],
      visibility: "PUBLIC",
    }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).content, "A real plain-text payload");
  passed("plain-text post payloads reach the documented creation endpoint");
  const body = new FormData();
  body.set(
    "file",
    new Blob(["test-only-media"], { type: "image/png" }),
    "test.png",
  );
  response = await call("/api/media", {
    method: "POST",
    body,
    headers: { Cookie: loginCookies },
  });
  assert.equal(response.status, 201);
  assert.match(requests.at(-1).contentType, /multipart\/form-data; boundary=/);
  assert.match(requests.at(-1).raw, /name="file"/);
  passed("multipart media uploads retain their file field and boundary");
  response = await call(
    "/api/search/posts?q=hello%20world&cursor=opaque-cursor&limit=10",
  );
  assert.equal(response.status, 200);
  assert.match(requests.at(-1).search, /cursor=opaque-cursor/);
  response = await call("/api/search/posts?q=rate-limit");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "19");
  passed("search pagination and rate-limit headers pass through unchanged");
  response = await call("/api/auth/logout", {
    method: "POST",
    headers: { Cookie: loginCookies },
  });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.ok(
    response.headers
      .getSetCookie()
      .every((cookie) => /Max-Age=0/i.test(cookie)),
  );
  passed("logout revokes upstream and clears both session cookies");
  temp = await mkdtemp(join(tmpdir(), "circle-tests-"));
  for (const [source, destination] of [
    ["src/lib/api/operations.ts", "operations.mjs"],
    ["src/lib/api/client.ts", "client.mjs"],
    ["src/lib/post-cache.ts", "post-cache.mjs"],
    ["src/lib/session-cache.ts", "session-cache.mjs"],
  ]) {
    const input = (await readFile(join(root, source), "utf8")).replace(
      '"./operations"',
      '"./operations.mjs"',
    );
    await writeFile(
      join(temp, destination),
      ts.transpileModule(input, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    );
  }
  const { operationUrl, api } = await import(
    pathToFileURL(join(temp, "client.mjs"))
  );
  assert.equal(
    operationUrl("searchUsers", { query: { q: "Jane Doe", cursor: "a+b" } }),
    "/api/backend/api/search/users?q=Jane+Doe&cursor=a%2Bb",
  );
  assert.throws(() => operationUrl("postsGet"), /Missing path parameter/);
  const { endpoints } = await import(
    pathToFileURL(join(temp, "operations.mjs"))
  );
  for (const endpoint of Object.values(endpoints))
    assert.ok(spec.paths[endpoint.path][endpoint.method.toLowerCase()]);
  passed(
    "every generated operation matches OpenAPI and encodes query parameters",
  );
  const nativeFetch = globalThis.fetch;
  let clientRequests = 0;
  globalThis.fetch = (url, options) => {
    clientRequests++;
    return nativeFetch(base + url, options);
  };
  try {
    await assert.rejects(
      api("searchPosts", { query: { q: "rate-limit" } }),
      (error) => error.status === 429,
    );
    await assert.rejects(
      api("searchPosts", { query: { q: "different-search" } }),
      (error) => error.status === 429 && error.retryAfter > 0,
    );
    assert.equal(clientRequests, 1);
  } finally {
    globalThis.fetch = nativeFetch;
  }
  passed("client honors Retry-After and prevents an immediate repeat request");
  const { QueryClient, QueryObserver } = await import("@tanstack/react-query");
  const { patchPost } = await import(
    pathToFileURL(join(temp, "post-cache.mjs"))
  );
  const cache = new QueryClient();
  const original = { id: "original", likeCount: 3, isLiked: false };
  cache.setQueryData(["post", "original"], original);
  cache.setQueryData(["posts", "global"], {
    pages: [
      {
        items: [
          original,
          { id: "quote", likeCount: 2, referencedPost: original },
        ],
        nextCursor: null,
      },
    ],
    pageParams: [undefined],
  });
  cache.setQueryData(["session"], { id: "original", private: true });
  patchPost(cache, "original", { isLiked: true, likeCount: 4 });
  assert.equal(cache.getQueryData(["post", "original"]).likeCount, 4);
  assert.equal(
    cache.getQueryData(["posts", "global"]).pages[0].items[1].referencedPost
      .likeCount,
    4,
  );
  assert.equal(cache.getQueryData(["session"]).private, true);
  patchPost(cache, "original", { isLiked: false, likeCount: 3 });
  assert.equal(cache.getQueryData(["post", "original"]).likeCount, 3);
  cache.clear();
  passed(
    "optimistic updates and rollback synchronize nested posts without changing session data",
  );
  const { changeSession } = await import(
    pathToFileURL(join(temp, "session-cache.mjs"))
  );
  const sessionCache = new QueryClient();
  sessionCache.setQueryData(["session"], { id: "old-account" });
  sessionCache.setQueryData(["posts", "saved"], {
    items: ["private-old-post"],
  });
  const observer = new QueryObserver(sessionCache, {
    queryKey: ["session"],
    enabled: false,
  });
  const observed = [];
  const unsubscribe = observer.subscribe((result) =>
    observed.push(result.data),
  );
  await changeSession(sessionCache, { id: "new-account" });
  assert.equal(observer.getCurrentResult().data.id, "new-account");
  assert.equal(sessionCache.getQueryData(["posts", "saved"]), undefined);
  await changeSession(sessionCache, null);
  assert.equal(observer.getCurrentResult().data, null);
  assert.ok(observed.length >= 2);
  unsubscribe();
  sessionCache.clear();
  passed(
    "account changes retain session observers and clear another account’s private cache",
  );
  console.log(
    `\n${checks} frontend checks passed. No backend data was modified.`,
  );
} finally {
  next.kill();
  await exit;
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  if (temp) {
    assert.ok(
      resolve(temp).startsWith(resolve(tmpdir()) + sep) &&
        basename(temp).startsWith("circle-tests-"),
      "Refusing to clean an unexpected temporary directory",
    );
    await rm(temp, { recursive: true, force: true });
  }
}
