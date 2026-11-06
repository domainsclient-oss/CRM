import { connection } from "next/server";

// Always rendered per request so every script carries this request's CSP nonce
// (requirements/04 §10).
export default async function ConsoleSegmentLayout({ children }: LayoutProps<"/platform">) {
  await connection();
  return children;
}
