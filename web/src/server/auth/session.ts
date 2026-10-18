import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** The signed-in user's internal UUID, or null. */
export async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** The signed-in user's internal UUID; redirects to /signin otherwise. */
export async function requireUserId(): Promise<string> {
  const id = await getUserId();
  if (!id) redirect("/signin");
  return id;
}
