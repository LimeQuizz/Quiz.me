import { NextResponse, type NextRequest } from "next/server";
import { allowedOrigins } from "@/lib/origin";
import {
  bodyLimitFor,
  buildCsp,
  generateNonce,
  HSTS_VALUE,
  isAllowedOrigin,
  STATIC_SECURITY_HEADERS,
} from "@/lib/security-headers";
import { clientIp, getRateLimiter, rateLimitDisabled, trustedProxyHops } from "@/lib/traffic-guard";

/**
 * Security middleware for every page and API route except /api/uploads
 * (which streams its body and applies the same checks itself):
 * - origin check on state-changing methods (CSRF defense in depth on top of
 *   Auth.js's CSRF token and Next's server action origin check)
 * - per-IP adaptive rate limit (see lib/traffic-guard.ts)
 * - request body size limit on Content-Length
 * - per-request CSP nonce and security headers
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Health probes come from the platform and must never be throttled.
  if (pathname !== "/api/health" && !rateLimitDisabled()) {
    const policy = req.method === "GET" || req.method === "HEAD" ? "read" : "write";
    const decision = getRateLimiter().check(clientIp(req.headers, trustedProxyHops()), policy);
    if (!decision.allowed) {
      const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
      res.headers.set("Retry-After", String(decision.retryAfterSeconds));
      return withHeaders(res, null, req);
    }
  }

  // OAuth callbacks are protected by state/PKCE and may arrive as a
  // cross-site form POST from the identity provider.
  const isOAuthCallback = pathname.startsWith("/api/auth/callback/");
  if (!isOAuthCallback && !isAllowedOrigin(req.method, req.headers.get("origin"), allowedOrigins(req))) {
    return withHeaders(NextResponse.json({ error: "bad_origin" }, { status: 403 }), null, req);
  }

  const length = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > bodyLimitFor(pathname)) {
    return withHeaders(NextResponse.json({ error: "too_large" }, { status: 413 }), null, req);
  }

  const nonce = generateNonce();
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === "development", https: isHttps(req) });
  // Next.js reads the nonce from the request's CSP header and adds it to the
  // scripts it renders.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp, req);
}

function withHeaders(res: NextResponse, csp: string | null, req: NextRequest): NextResponse {
  res.headers.set("Content-Security-Policy", csp ?? "default-src 'none'; frame-ancestors 'none'");
  for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) res.headers.set(k, v);
  if (isHttps(req)) res.headers.set("Strict-Transport-Security", HSTS_VALUE);
  return res;
}

function isHttps(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return proto === "https";
}

export const config = {
  // Node.js runtime so the in-memory rate limiter is shared by all requests
  // in the process.
  runtime: "nodejs",
  matcher: ["/((?!api/uploads|_next/static|_next/image|favicon.ico).*)"],
};
