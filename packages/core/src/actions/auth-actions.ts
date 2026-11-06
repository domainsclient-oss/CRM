import "server-only";
import { z } from "zod";
import {
  displayNameSchema,
  emailSchema,
  idTokenSchema,
  passwordSchema,
  tokenSchema,
} from "@crm/shared/schemas/auth";
import { AppError } from "../errors";
import { deliverQueuedMailToConsole } from "../mail";
import { POLICIES, enforceRateLimit } from "../rate-limit";
import { requestPasswordReset } from "../services/auth";
import { acceptInvitation } from "../services/invitations";
import { fingerprint } from "../tokens";
import type { createActionWrappers } from "./wrappers";

// Public auth actions shared by apps/web and apps/console. Each app re-exports them from
// its own 'use server' module (Server Action modules must live in the app).

type Wrappers = ReturnType<typeof createActionWrappers>;

export function defineAuthActions(actions: Wrappers) {
  const requestPasswordResetAction = actions.public({
    name: "auth.requestPasswordReset",
    schema: z.object({ email: emailSchema }),
    rateLimit: POLICIES.passwordResetByIp,
    handler: async ({ email }, req) => {
      await requestPasswordReset(email, req);
      await deliverQueuedMailToConsole(); // local dev only; no-op with a real provider
      return { sent: true as const }; // same answer whether or not the account exists
    },
  });

  const acceptInvitationAction = actions.public({
    name: "invitations.accept",
    schema: z.object({
      token: tokenSchema,
      displayName: displayNameSchema.optional(),
      password: passwordSchema.optional(),
      idToken: idTokenSchema.optional(),
    }),
    rateLimit: POLICIES.invitationAcceptByIp,
    handler: async (input, req) => {
      await enforceRateLimit(POLICIES.invitationAcceptByToken, fingerprint(input.token));
      const ctx = { host: req.host, requestId: req.requestId };
      if (input.idToken && !input.password && !input.displayName) {
        return {
          kind: (await acceptInvitation({ token: input.token, idToken: input.idToken }, ctx)).kind,
        };
      }
      if (input.password && input.displayName && !input.idToken) {
        const newAccount = { displayName: input.displayName, password: input.password };
        return { kind: (await acceptInvitation({ token: input.token, newAccount }, ctx)).kind };
      }
      throw new AppError("VALIDATION", "choose_one_mode", { _form: ["Invalid request"] });
    },
  });

  return { requestPasswordResetAction, acceptInvitationAction };
}
