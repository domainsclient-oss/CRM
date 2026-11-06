import "server-only";
import { createActionWrappers } from "@crm/core/actions";
import { nextRequestSource } from "./request";

/** The only way to build Server Actions in this app (AGENTS.md rule 3). */
export const actions = createActionWrappers(nextRequestSource);
