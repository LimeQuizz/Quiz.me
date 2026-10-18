/** Origins allowed to send state-changing requests: the configured public URL. */
export function allowedOrigins(req: { nextUrl: { origin: string } }): string[] {
  const configured = process.env.AUTH_URL;
  if (configured) {
    try {
      return [new URL(configured).origin];
    } catch {
      // fall through to the request's own origin
    }
  }
  return [req.nextUrl.origin];
}
