"use server";

import { defineAuthActions } from "@crm/core/actions/auth";
import { actions } from "@/server/actions";

// Public auth actions (no session yet). Logic lives in @crm/core; wrappers enforce
// same-origin and IP rate limits.
const auth = defineAuthActions(actions);

export const requestPasswordResetAction = auth.requestPasswordResetAction;
export const acceptInvitationAction = auth.acceptInvitationAction;
