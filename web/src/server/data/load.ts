import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "./errors";

/** Run a data-layer read in a page; NotFoundError becomes the 404 page. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
