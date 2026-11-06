// Stand-in for each app's `@/server/actions` in the registry isolation suite: same wrappers,
// but the request (host, Origin, cookies) is set by the test instead of read from Next.js.
import { createActionWrappers, type RequestInfo } from "@crm/core/actions";

let current: RequestInfo | undefined;

export function setRequest(req: RequestInfo): void {
  current = req;
}

export const actions = createActionWrappers(async () => {
  if (!current) throw new Error("setRequest() was not called");
  return current;
});
