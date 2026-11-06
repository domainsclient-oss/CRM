"use server";

import { z } from "zod";
import { deliverQueuedMailToConsole } from "@crm/core/mail";
import {
  changeRole,
  forceSignOut,
  inviteMember,
  removeMember,
  resendInvitation,
  revokeInvitation,
  transferOwnership,
} from "@crm/core/services/members";
import { emailSchema } from "@crm/shared/schemas/auth";
import { actions } from "@/server/actions";

// Team management actions (T-03-05). Roles in input are validated against the enum; the
// actor's own role always comes from the server context.

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const assignableRole = z.enum(["admin", "manager", "member", "viewer"]);

export const inviteMemberAction = actions.tenant({
  name: "members.invite",
  permission: "member.invite",
  schema: z.object({ email: emailSchema, role: assignableRole }),
  handler: async (ctx, input) => {
    const result = await inviteMember(ctx, input);
    await deliverQueuedMailToConsole();
    return { ...result, email: input.email };
  },
});

export const resendInvitationAction = actions.tenant({
  name: "members.resendInvitation",
  permission: "member.invite",
  schema: z.object({ invitationId: id }),
  handler: async (ctx, { invitationId }) => {
    await resendInvitation(ctx, invitationId);
    await deliverQueuedMailToConsole();
    return { invitationId };
  },
});

export const revokeInvitationAction = actions.tenant({
  name: "members.revokeInvitation",
  permission: "member.invite",
  schema: z.object({ invitationId: id }),
  handler: async (ctx, { invitationId }) => {
    await revokeInvitation(ctx, invitationId);
    return { invitationId };
  },
});

export const changeRoleAction = actions.tenant({
  name: "members.changeRole",
  permission: "member.update",
  schema: z.object({ uid: id, role: assignableRole }),
  handler: async (ctx, input) => {
    await changeRole(ctx, input);
    return input;
  },
});

export const removeMemberAction = actions.tenant({
  name: "members.remove",
  permission: "member.remove",
  schema: z.object({ uid: id, reassignTo: id }),
  handler: async (ctx, input) => removeMember(ctx, input),
});

export const forceSignOutAction = actions.tenant({
  name: "members.forceSignOut",
  permission: "member.forceSignOut",
  schema: z.object({ uid: id }),
  handler: async (ctx, { uid }) => {
    await forceSignOut(ctx, uid);
    return { uid };
  },
});

export const transferOwnershipAction = actions.tenant({
  name: "members.transferOwnership",
  permission: "tenant.transferOwnership",
  reauth: true,
  schema: z.object({ toUid: id }),
  handler: async (ctx, { toUid }) => {
    await transferOwnership(ctx, toUid);
    await deliverQueuedMailToConsole();
    return { toUid };
  },
});
