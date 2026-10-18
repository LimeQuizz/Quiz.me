/**
 * Security headers. Pure functions so they can be unit tested; applied by
 * src/middleware.ts to every page and API response.
 */

export interface CspOptions {
  nonce: string;
  dev?: boolean;
  /** Served over https (directly or behind a TLS-terminating ingress). */
  https?: boolean;
}

// Sign-in forms POST to /api/auth/signin/<provider>, which redirects to the
// provider. Chromium applies form-action to that redirect, so the provider
// origins must be listed.
const FORM_ACTION_ORIGINS = ["https://accounts.google.com", "https://login.microsoftonline.com", "https://login.live.com"];

export function buildCsp({ nonce, dev = false, https = true }: CspOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", `'nonce-${nonce}'`],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(dev ? ["ws:"] : [])],
    "form-action": ["'self'", ...FORM_ACTION_ORIGINS],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (https && !dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/** HSTS is normally set by the TLS-terminating ingress; the app adds it too when served over https. */
export const HSTS_VALUE = "max-age=63072000; includeSubDomains";

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Origin check for state-changing requests. Browsers always send Origin on
 * cross-site and same-site POSTs; a missing or different Origin is refused.
 */
export function isAllowedOrigin(method: string, originHeader: string | null, allowedOrigins: string[]): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (!originHeader || originHeader === "null") return false;
  return allowedOrigins.includes(originHeader);
}

export const DEFAULT_BODY_LIMIT = 3 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
/** Body limit for a path, enforced on Content-Length by the middleware. */
export function bodyLimitFor(pathname: string): number {
  return pathname === "/api/uploads" ? UPLOAD_MAX_BYTES : DEFAULT_BODY_LIMIT;
}
