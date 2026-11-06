// Every Firestore query shape the server runs (requirements/03 §8, R-04, T-03-10).
// Rule: a new query in code needs an entry here in the same PR; the index-coverage test
// (firebase/test/indexes.test.ts) then requires a matching composite index when needed.
// The emulator does NOT enforce indexes — this registry is what catches gaps before staging.
// List shapes are derived from the allowlisted list specs (every filter × sort × scope), so a
// new filter or sort automatically requires its index. `pnpm indexes:gen` writes the file.

import { LIST_ENTITIES, LIST_SPECS, type ListEntity } from "@crm/shared/records/list-specs";

export interface QueryShape {
  id: string;
  /** Collection (group) id, e.g. "contacts" for tenants/{t}/contacts. */
  collection: string;
  scope: "COLLECTION" | "COLLECTION_GROUP";
  equality: string[];
  arrayContains?: string;
  /** Range filter and/or ordering, in index order. */
  orderBy?: Array<{ field: string; direction: "ASCENDING" | "DESCENDING" }>;
  /** Where it's used (for reviewers). */
  usedBy: string;
}

export function listShapeId(
  entity: ListEntity,
  scope: "all" | "own",
  filterId: string | null,
  sortId: string,
): string {
  return `list.${entity}.${scope}.${filterId ?? "none"}.${sortId}`;
}

const DIRECTION = { asc: "ASCENDING", desc: "DESCENDING" } as const;

/** records/list.ts listRecords: one optional filter × sort × {all, own} per entity. */
function listShapes(): QueryShape[] {
  const shapes: QueryShape[] = [];
  for (const entity of LIST_ENTITIES) {
    const spec = LIST_SPECS[entity];
    for (const scope of ["all", "own"] as const) {
      for (const filter of [null, ...spec.filters]) {
        if (scope === "own" && filter?.kind === "member") continue; // same as no filter
        for (const sort of spec.sorts) {
          const equality = ["isDeleted"];
          if (scope === "own") equality.push(spec.ownerField);
          if (filter && filter.kind !== "tag") equality.push(filter.field);
          shapes.push({
            id: listShapeId(entity, scope, filter?.id ?? null, sort.id),
            collection: entity,
            scope: "COLLECTION",
            equality,
            ...(filter?.kind === "tag" ? { arrayContains: filter.field } : {}),
            orderBy: [{ field: sort.field, direction: DIRECTION[sort.direction] }],
            usedBy: "records/list.ts listRecords",
          });
        }
      }
    }
  }
  return shapes;
}

const OWNED = ["companies", "contacts", "leads", "deals", "tasks"] as const;

/** Phase 4 record queries outside the list kit. */
const RECORD_SHAPES: QueryShape[] = [
  ...OWNED.map((collection): QueryShape => ({
    id: `trash.${collection}`,
    collection,
    scope: "COLLECTION",
    equality: ["isDeleted"],
    orderBy: [{ field: "deletedAt", direction: "DESCENDING" }],
    usedBy: "records/trash.ts listTrash + purgeExpired (deletedAt < T)",
  })),
  {
    id: "activities.timeline",
    collection: "activities",
    scope: "COLLECTION",
    equality: ["isDeleted"],
    arrayContains: "relatedKeys",
    orderBy: [{ field: "occurredAt", direction: "DESCENDING" }],
    usedBy: "records/activities.ts listTimeline",
  },
  {
    id: "activities.byRelated",
    collection: "activities",
    scope: "COLLECTION",
    equality: [],
    arrayContains: "relatedKeys",
    usedBy: "records/leads.ts convertLead (relink), records/trash.ts purge",
  },
  ...(["all", "own"] as const).map((scope): QueryShape => ({
    id: `deals.board.${scope}`,
    collection: "deals",
    scope: "COLLECTION",
    equality: [
      "isDeleted",
      ...(scope === "own" ? ["ownerUid"] : []),
      "pipelineId",
      "status",
      "stageId",
    ],
    orderBy: [{ field: "updatedAt", direction: "DESCENDING" }],
    usedBy: "records/deals.ts loadBoard (column page + count/sum aggregations)",
  })),
  {
    id: "deals.byStage",
    collection: "deals",
    scope: "COLLECTION",
    equality: ["pipelineId", "stageId"],
    usedBy: "records/deals.ts updatePipeline (move deals off a removed stage)",
  },
  {
    id: "tasks.mine",
    collection: "tasks",
    scope: "COLLECTION",
    equality: ["isDeleted", "assigneeUid", "status"],
    orderBy: [{ field: "dueAt", direction: "ASCENDING" }],
    usedBy: "records/tasks.ts listMyTasks + myTaskCounts (dueAt range)",
  },
  {
    id: "contacts.byEmail",
    collection: "contacts",
    scope: "COLLECTION",
    equality: ["isDeleted", "emailNormalized"],
    usedBy: "records/contacts.ts duplicate check (FR-CON-003), records/leads.ts convertLead",
  },
  {
    id: "companies.byDomain",
    collection: "companies",
    scope: "COLLECTION",
    equality: ["isDeleted", "domainNormalized"],
    usedBy: "records/companies.ts duplicate check (FR-COM-003), records/leads.ts convertLead",
  },
  {
    id: "companies.byName",
    collection: "companies",
    scope: "COLLECTION",
    equality: ["isDeleted", "nameLower"],
    usedBy: "records/leads.ts convertLead (match company by name)",
  },
  ...(["contacts", "deals"] as const).map((collection): QueryShape => ({
    id: `${collection}.byCompanyAll`,
    collection,
    scope: "COLLECTION",
    equality: ["companyId"],
    usedBy: "records/trash.ts purge (unlink from a purged company)",
  })),
  {
    id: "tagDefinitions.byName",
    collection: "tagDefinitions",
    scope: "COLLECTION",
    equality: [],
    orderBy: [{ field: "nameNormalized", direction: "ASCENDING" }],
    usedBy: "records/tags.ts listTags",
  },
];

const DOMAIN_SHAPES: QueryShape[] = [
  {
    id: "tenantDomains.byTenant",
    collection: "tenantDomains",
    scope: "COLLECTION",
    equality: ["tenantId"],
    usedBy: "domains/service.ts listDomains, setCanonicalDomain",
  },
  {
    id: "tenantDomains.fallback",
    collection: "tenantDomains",
    scope: "COLLECTION",
    equality: ["tenantId", "type"],
    usedBy: "domains/service.ts removeDomain (find platform fallback host)",
  },
  {
    id: "tenantDomains.byStatus",
    collection: "tenantDomains",
    scope: "COLLECTION",
    equality: ["status"],
    usedBy: "domains/service.ts runDomainChecks",
  },
  {
    id: "staff.active",
    collection: "staff",
    scope: "COLLECTION",
    equality: ["status"],
    usedBy: "services/agency-admin.ts listStaff",
  },
  {
    id: "staff.byEmail",
    collection: "staff",
    scope: "COLLECTION",
    equality: ["email", "status"],
    usedBy: "services/agency-admin.ts inviteStaff (duplicate check)",
  },
  {
    id: "invitations.pendingCount",
    collection: "invitations",
    scope: "COLLECTION",
    equality: ["status"],
    usedBy: "services/members.ts inviteMember (seat limit)",
  },
];

// ---- Phase 6: search, dashboard/reports, notifications, reminders, audit viewer ----

const ASC = "ASCENDING" as const;
const DESC = "DESCENDING" as const;
const SCOPES = ["all", "own"] as const;
const scoped = (scope: "all" | "own", ...rest: string[]) => [
  "isDeleted",
  ...(scope === "own" ? ["ownerUid"] : []),
  ...rest,
];

const PHASE6_SHAPES: QueryShape[] = [
  ...SCOPES.flatMap((scope) =>
    (
      [
        ["contacts", "fullNameLower"],
        ["companies", "nameLower"],
        ["leads", "fullNameLower"],
        ["deals", "nameLower"],
      ] as const
    ).map(([collection, name]): QueryShape => ({
      id: `search.${collection}.${scope}`,
      collection,
      scope: "COLLECTION",
      equality: scoped(scope),
      arrayContains: "searchTokens",
      orderBy: [{ field: name, direction: ASC }],
      usedBy: "records/search.ts globalSearch",
    })),
  ),
  ...SCOPES.flatMap((scope): QueryShape[] => [
    {
      id: `reports.dealsClosed.${scope}`,
      collection: "deals",
      scope: "COLLECTION",
      equality: scoped(scope, "status"),
      orderBy: [{ field: "closedAt", direction: ASC }],
      usedBy: "reports.ts closedInRange (dashboard won, won vs lost)",
    },
    {
      id: `reports.leadsCreated.${scope}`,
      collection: "leads",
      scope: "COLLECTION",
      equality: scoped(scope),
      orderBy: [{ field: "createdAt", direction: ASC }],
      usedBy: "reports.ts dashboard new leads / conversion",
    },
    {
      id: `reports.leadsConverted.${scope}`,
      collection: "leads",
      scope: "COLLECTION",
      equality: scoped(scope, "status"),
      orderBy: [{ field: "createdAt", direction: ASC }],
      usedBy: "reports.ts dashboard conversion",
    },
    {
      id: `reports.leadsBySource.${scope}`,
      collection: "leads",
      scope: "COLLECTION",
      equality: scoped(scope, "source"),
      orderBy: [{ field: "createdAt", direction: ASC }],
      usedBy: "reports.ts leadSourceConversion",
    },
    {
      id: `reports.leadsBySourceConverted.${scope}`,
      collection: "leads",
      scope: "COLLECTION",
      equality: scoped(scope, "source", "status"),
      orderBy: [{ field: "createdAt", direction: ASC }],
      usedBy: "reports.ts leadSourceConversion",
    },
  ]),
  {
    id: "activities.recent",
    collection: "activities",
    scope: "COLLECTION",
    equality: ["isDeleted"],
    orderBy: [{ field: "occurredAt", direction: DESC }],
    usedBy: "reports.ts recentActivities (workspace)",
  },
  {
    id: "activities.recentMine",
    collection: "activities",
    scope: "COLLECTION",
    equality: ["isDeleted", "createdBy"],
    orderBy: [{ field: "occurredAt", direction: DESC }],
    usedBy: "reports.ts recentActivities (Members)",
  },
  {
    id: "activities.byUserType",
    collection: "activities",
    scope: "COLLECTION",
    equality: ["isDeleted", "createdBy", "type"],
    orderBy: [{ field: "occurredAt", direction: ASC }],
    usedBy: "reports.ts activitiesByUser",
  },
  {
    id: "notifications.mine",
    collection: "notifications",
    scope: "COLLECTION",
    equality: ["recipientUid"],
    orderBy: [{ field: "createdAt", direction: DESC }],
    usedBy: "notifications.ts listNotifications",
  },
  {
    id: "notifications.unread",
    collection: "notifications",
    scope: "COLLECTION",
    equality: ["recipientUid", "readAt"],
    usedBy: "notifications.ts unreadCount / markRead(all)",
  },
  {
    id: "tasks.reminders",
    collection: "tasks",
    scope: "COLLECTION_GROUP",
    equality: ["isDeleted", "status", "reminderSentAt"],
    orderBy: [{ field: "reminderAt", direction: ASC }],
    usedBy: "jobs/reminders.ts sendTaskReminders (system job)",
  },
  {
    id: "audit.byAction",
    collection: "auditLogs",
    scope: "COLLECTION",
    equality: ["action"],
    orderBy: [{ field: "createdAt", direction: DESC }],
    usedBy: "audit-viewer.ts listAudit (action filter)",
  },
  {
    id: "audit.byActor",
    collection: "auditLogs",
    scope: "COLLECTION",
    equality: ["actor.uid"],
    orderBy: [{ field: "createdAt", direction: DESC }],
    usedBy: "audit-viewer.ts listAudit (actor filter)",
  },
  {
    id: "jobs.recent",
    collection: "jobs",
    scope: "COLLECTION",
    equality: [],
    orderBy: [{ field: "createdAt", direction: DESC }],
    usedBy: "jobs/runner.ts listJobs",
  },
  {
    id: "jobs.running",
    collection: "jobs",
    scope: "COLLECTION",
    equality: ["status"],
    usedBy: "functions nightly (resume stuck jobs)",
  },
  {
    id: "tenants.activeById",
    collection: "tenants",
    scope: "COLLECTION",
    equality: ["status"],
    usedBy: "functions nightly (iterate active tenants by document ID)",
  },
  {
    id: "members.activeSince",
    collection: "members",
    scope: "COLLECTION",
    equality: ["status"],
    orderBy: [{ field: "lastSeenAt", direction: ASC }],
    usedBy: "services/agency-admin.ts agencyUsageReport (active users, 30 days)",
  },
  {
    id: "members.byOwnerRole",
    collection: "members",
    scope: "COLLECTION",
    equality: ["role", "status"],
    usedBy: "privacy.ts deleteAccount (sole-owner check)",
  },
  {
    id: "tenants.pendingDeletion",
    collection: "tenants",
    scope: "COLLECTION",
    equality: ["status"],
    orderBy: [{ field: "deletionScheduledFor", direction: ASC }],
    usedBy: "tenant-deletion.ts purgeDueTenants (system job)",
  },
];

export const QUERY_SHAPES: QueryShape[] = [
  ...PHASE6_SHAPES,
  ...DOMAIN_SHAPES,
  ...listShapes(),
  ...RECORD_SHAPES,
  {
    id: "tenants.byAgency",
    collection: "tenants",
    scope: "COLLECTION",
    equality: ["agencyId"],
    usedBy: "services/admin.ts listAgencyWorkspaces",
  },
  {
    id: "privilegedSessions.byUserDevice",
    collection: "privilegedSessions",
    scope: "COLLECTION",
    equality: ["uid", "device"],
    usedBy: "services/auth.ts recordPrivilegedLogin",
  },
  {
    id: "mailOutbox.queued",
    collection: "mailOutbox",
    scope: "COLLECTION",
    equality: ["status"],
    usedBy: "mail.ts deliverQueuedMailToConsole",
  },
  {
    id: "members.active",
    collection: "members",
    scope: "COLLECTION",
    equality: ["status"],
    usedBy: "services/members.ts listTeam",
  },
  {
    id: "members.byEmail",
    collection: "members",
    scope: "COLLECTION",
    equality: ["email", "status"],
    usedBy: "services/members.ts inviteMember (duplicate check)",
  },
  {
    id: "invitations.pending",
    collection: "invitations",
    scope: "COLLECTION",
    equality: ["status"],
    usedBy: "services/members.ts listTeam",
  },
  {
    id: "invitations.pendingByEmail",
    collection: "invitations",
    scope: "COLLECTION",
    equality: ["email", "status"],
    usedBy: "services/members.ts inviteMember (duplicate check)",
  },
  {
    id: "owned.byOwner",
    collection: "contacts",
    scope: "COLLECTION",
    equality: ["ownerUid"],
    usedBy: "services/members.ts reassignRecords (all owned collections)",
  },
];

/**
 * Equality-only queries are served by merging single-field indexes; anything combining
 * equality/array filters with ordering or ranges needs a composite index.
 */
export function needsCompositeIndex(shape: QueryShape): boolean {
  const filterFields = shape.equality.length + (shape.arrayContains ? 1 : 0);
  const orderFields = shape.orderBy?.length ?? 0;
  if (orderFields === 0) return false;
  return filterFields + orderFields > 1;
}
