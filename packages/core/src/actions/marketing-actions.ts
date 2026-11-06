import "server-only";
import { z } from "zod";
import { TEAM_SIZES } from "@crm/shared/content/marketing";
import { emailSchema } from "@crm/shared/schemas/auth";
import { deliverQueuedMailToConsole } from "../mail";
import { sendWorkspaceList, submitContactRequest } from "../marketing";
import { POLICIES, enforceRateLimit } from "../rate-limit";
import { fingerprint } from "../tokens";
import type { createActionWrappers } from "./wrappers";

// Public marketing-site actions (T-08-01). apps/web re-exports them from a 'use server' module.

type Wrappers = ReturnType<typeof createActionWrappers>;

const text = (max: number) => z.string().trim().max(max);

export function defineMarketingActions(actions: Wrappers) {
  const submitContactAction = actions.public({
    name: "marketing.contact",
    schema: z.object({
      name: text(100).min(1),
      email: emailSchema,
      company: text(120).min(1),
      teamSize: z.enum(TEAM_SIZES),
      message: text(2000),
      // Honeypot: hidden from people, filled in by naive bots.
      website: text(200).optional(),
    }),
    rateLimit: POLICIES.contactRequestByIp,
    handler: async ({ website, ...input }, req) => {
      // Bots get the same success answer; nothing is stored.
      if (!website) {
        await submitContactRequest(input, req.requestId);
        await deliverQueuedMailToConsole();
      }
      return { received: true as const };
    },
  });

  const findWorkspaceAction = actions.public({
    name: "marketing.findWorkspace",
    schema: z.object({ email: emailSchema }),
    rateLimit: POLICIES.workspaceFinderByIp,
    handler: async ({ email }, req) => {
      await enforceRateLimit(POLICIES.workspaceFinderByEmail, fingerprint(email));
      await sendWorkspaceList(email, req.requestId);
      await deliverQueuedMailToConsole(); // local dev only; no-op with a real provider
      return { sent: true as const }; // same answer whether or not the account exists
    },
  });

  return { submitContactAction, findWorkspaceAction };
}
