import NextAuth from "next-auth";
import { buildAuthConfig } from "@/server/auth/config";

// Lazy initialization: configuration (and the database connection) is built
// on first request, not at build time.
export const { handlers, auth, signIn, signOut } = NextAuth(() => buildAuthConfig());
