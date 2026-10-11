import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { endpoints } from "@/lib/api/operations";
import type { components } from "@/lib/api/schema";

type Auth = components["schemas"]["AuthResponseDto"];
const origin = (process.env.API_ORIGIN ?? "http://localhost:3002").replace(
  /\/$/,
  "",
);
const accessCookie = "social_access";
const refreshCookie = "social_refresh";
// One shared rotation per old refresh token, including concurrent browser tabs.
// Multi-instance hosting requires a shared distributed lock (see README).
const rotations = new Map<
  string,
  { promise: Promise<Auth>; expires: number }
>();
const allowed = Object.values(endpoints).map((e) => ({
  ...e,
  pattern: new RegExp("^" + e.path.replace(/\{[^}]+\}/g, "[^/]+") + "$"),
}));
function setSession(response: NextResponse, auth: Auth) {
  const options = {
    httpOnly: true,
    secure:
      process.env.SESSION_COOKIE_SECURE === "false"
        ? false
        : process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/backend",
  };
  response.cookies.set(accessCookie, auth.accessToken, {
    ...options,
    expires: new Date(auth.accessTokenExpiresAt),
  });
  response.cookies.set(refreshCookie, auth.refreshToken, {
    ...options,
    expires: new Date(auth.refreshTokenExpiresAt),
  });
}
function clearSession(response: NextResponse) {
  for (const name of [accessCookie, refreshCookie])
    response.cookies.set(name, "", {
      path: "/api/backend",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
    });
}
async function rotate(token: string) {
  const key = createHash("sha256").update(token).digest("hex");
  for (const [k, value] of rotations)
    if (value.expires < Date.now()) rotations.delete(k);
  let entry = rotations.get(key);
  if (!entry) {
    const promise = (async () => {
      const response = await fetch(origin + endpoints.authRefresh.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: token }),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? "SESSION_EXPIRED"
            : "API_UNAVAILABLE",
        );
      return (await response.json()) as Auth;
    })();
    entry = { promise, expires: Date.now() + 30000 };
    rotations.set(key, entry);
  }
  return entry.promise;
}
async function handler(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (
    path.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[/\\]/.test(segment),
    )
  )
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid path." },
      { status: 400 },
    );
  const apiPath = "/" + path.map(encodeURIComponent).join("/");
  const operation = allowed.find(
    (e) => e.method === request.method && e.pattern.test(apiPath),
  );
  if (
    !operation ||
    apiPath === endpoints.authRefresh.path ||
    apiPath.includes("/media/files/")
  )
    return NextResponse.json(
      { code: "NOT_FOUND", message: "Unsupported operation." },
      { status: 404 },
    );
  if (
    request.method !== "GET" &&
    (request.headers.get("X-Social-Client") !== "web" ||
      (request.headers.get("origin") &&
        request.headers.get("origin") !==
          (process.env.APP_ORIGIN ??
            `${request.nextUrl.protocol}//${request.headers.get("host")}`)))
  )
    return NextResponse.json(
      { code: "FORBIDDEN", message: "Invalid request origin." },
      { status: 403 },
    );
  let token = request.cookies.get(accessCookie)?.value;
  const refresh = request.cookies.get(refreshCookie)?.value;
  let rotated: Auth | undefined;
  const signingIn =
    apiPath === endpoints.authLogin.path ||
    apiPath === endpoints.authRegister.path;
  const logout =
    apiPath === endpoints.authLogout.path ||
    apiPath === endpoints.authLogoutAll.path;
  try {
    if (!signingIn && !token && refresh) {
      rotated = await rotate(refresh);
      token = rotated.accessToken;
    }
    const body =
      request.method === "GET" ? undefined : await request.arrayBuffer();
    const send = () =>
      fetch(origin + apiPath + request.nextUrl.search, {
        method: request.method,
        cache: "no-store",
        redirect: "error",
        headers: {
          ...(request.headers.get("content-type")
            ? { "Content-Type": request.headers.get("content-type")! }
            : {}),
          ...(!signingIn && token ? { Authorization: `Bearer ${token}` } : {}),
          // Step-up re-authentication token for sensitive admin operations (never stored here).
          ...(request.headers.get("x-step-up-token")
            ? { "X-Step-Up-Token": request.headers.get("x-step-up-token")! }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(120000),
      });
    let upstream = await send();
    if (upstream.status === 401 && refresh && !signingIn && !rotated) {
      const error = await upstream
        .clone()
        .json()
        .catch(() => ({}));
      if (error.code === "INVALID_TOKEN") {
        rotated = await rotate(refresh);
        token = rotated.accessToken;
        upstream = await send();
      }
    }
    let response: NextResponse;
    if (signingIn && upstream.ok) {
      const auth: Auth = await upstream.json();
      response = NextResponse.json(
        { user: auth.user },
        { status: upstream.status },
      );
      setSession(response, auth);
    } else {
      response = new NextResponse(
        upstream.status === 204 ? null : await upstream.arrayBuffer(),
        {
          status: upstream.status,
          headers: {
            "Content-Type":
              upstream.headers.get("content-type") ?? "application/json",
            "Cache-Control": "no-store",
            ...(upstream.headers.get("retry-after")
              ? { "Retry-After": upstream.headers.get("retry-after")! }
              : {}),
            ...(upstream.headers.get("x-request-id")
              ? { "X-Request-Id": upstream.headers.get("x-request-id")! }
              : {}),
          },
        },
      );
      if (rotated) setSession(response, rotated);
    }
    if ((logout && upstream.ok) || (!signingIn && upstream.status === 401))
      clearSession(response);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const expired =
      error instanceof Error && error.message === "SESSION_EXPIRED";
    const response = NextResponse.json(
      {
        code: expired ? "INVALID_REFRESH_TOKEN" : "API_UNAVAILABLE",
        message: expired
          ? "Your session has expired. Please sign in again."
          : "We couldn’t reach the server. Please try again shortly.",
      },
      { status: expired ? 401 : 502 },
    );
    if (expired) clearSession(response);
    return response;
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
