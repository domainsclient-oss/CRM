"use server";

import { defineMarketingActions } from "@crm/core/actions/marketing";
import { actions } from "@/server/actions";

// Public marketing actions (no session). Logic lives in @crm/core.
const marketing = defineMarketingActions(actions);

export const submitContactAction = marketing.submitContactAction;
export const findWorkspaceAction = marketing.findWorkspaceAction;
