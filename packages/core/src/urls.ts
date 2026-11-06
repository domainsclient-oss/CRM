import "server-only";
import { getServerEnv } from "./server-env";

/** Absolute URL on one of our hosts. Links in emails are built from stored hosts, never request headers. */
export function hostUrl(host: string, path: string): string {
  const env = getServerEnv();
  const local = env.APP_ENV === "local" || env.APP_ENV === "test";
  return `${local ? "http" : "https"}://${host}${path.startsWith("/") ? path : `/${path}`}`;
}
