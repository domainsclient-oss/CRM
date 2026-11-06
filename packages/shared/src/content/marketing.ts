// Public marketing copy (FR-PUB-001, requirements/07 §4). English only (A-07). Factual claims only:
// every number here matches a real product limit or behaviour. Product name is the placeholder
// until OQ-16 (platform brand) is answered.

export const PRODUCT = "CRM";

export interface PageMeta {
  path: string;
  title: string; // ≤ 60 characters (07 §2)
  description: string; // ≤ 155 characters
  updated: string; // ISO date shown as "Last updated"
}

export const PAGES = {
  home: {
    path: "/",
    title: `${PRODUCT} — white-label CRM for agencies`,
    description:
      "A secure, multi-tenant CRM that agencies resell under their own brand: contacts, leads, deals, tasks, and reports for each client workspace.",
    updated: "2026-10-10",
  },
  features: {
    path: "/features",
    title: `Features — ${PRODUCT}`,
    description:
      "Contacts, companies, leads, a deal pipeline, tasks, activity timelines, reports, CSV import and export — in a separate workspace for every client.",
    updated: "2026-10-10",
  },
  agencies: {
    path: "/agencies",
    title: `For agencies — ${PRODUCT}`,
    description:
      "Resell a CRM under your brand: your logo and colours, your domain, your prices. Create client workspaces and manage them from one partner console.",
    updated: "2026-10-10",
  },
  plans: {
    path: "/plans",
    title: `Plans — ${PRODUCT}`,
    description:
      "Compare plan limits and features. Prices are set by your agency partner in your local currency.",
    updated: "2026-10-10",
  },
  security: {
    path: "/security",
    title: `Security — ${PRODUCT}`,
    description:
      "How client data is isolated and protected: separate workspaces, server-side access checks, audit logs, encryption in transit, and privacy tools.",
    updated: "2026-10-10",
  },
  about: {
    path: "/about",
    title: `About — ${PRODUCT}`,
    description: `Why we built ${PRODUCT}: a CRM that agencies can brand, host on their own domains, and offer to every client.`,
    updated: "2026-10-10",
  },
  contact: {
    path: "/contact",
    title: `Request a demo — ${PRODUCT}`,
    description: "Tell us about your agency and we'll show you how the white-label CRM works.",
    updated: "2026-10-10",
  },
  findWorkspace: {
    path: "/find-workspace",
    title: `Find your workspace — ${PRODUCT}`,
    description:
      "Enter your email address and we'll send you the sign-in links for your workspaces.",
    updated: "2026-10-10",
  },
  docs: {
    path: "/docs",
    title: `Help centre — ${PRODUCT}`,
    description: `Step-by-step answers for using ${PRODUCT}: importing contacts, the pipeline, roles, branding, custom domains, and privacy.`,
    updated: "2026-10-10",
  },
  faq: {
    path: "/faq",
    title: `FAQ — ${PRODUCT}`,
    description: `Short answers to common questions about ${PRODUCT} workspaces, data, security, and agencies.`,
    updated: "2026-10-10",
  },
  glossary: {
    path: "/glossary",
    title: `Glossary — ${PRODUCT}`,
    description:
      "One-sentence definitions of CRM terms: lead, contact, deal, pipeline, lifecycle stage, workspace.",
    updated: "2026-10-10",
  },
  privacy: {
    path: "/legal/privacy",
    title: `Privacy policy — ${PRODUCT}`,
    description: `How ${PRODUCT} collects, uses, and protects personal data.`,
    updated: "2026-10-10",
  },
  terms: {
    path: "/legal/terms",
    title: `Terms of service — ${PRODUCT}`,
    description: `The terms that apply when you use ${PRODUCT}.`,
    updated: "2026-10-10",
  },
  cookies: {
    path: "/legal/cookies",
    title: `Cookie policy — ${PRODUCT}`,
    description: `Which cookies ${PRODUCT} uses and why.`,
    updated: "2026-10-10",
  },
} satisfies Record<string, PageMeta>;

export const NAV: Array<[string, string]> = [
  ["/features", "Features"],
  ["/agencies", "For agencies"],
  ["/plans", "Plans"],
  ["/security", "Security"],
  ["/docs", "Help"],
];

export const FOOTER: Array<[string, string]> = [
  ["/about", "About"],
  ["/contact", "Request a demo"],
  ["/faq", "FAQ"],
  ["/glossary", "Glossary"],
  ["/find-workspace", "Find your workspace"],
  ["/legal/privacy", "Privacy"],
  ["/legal/terms", "Terms"],
  ["/legal/cookies", "Cookies"],
];

export const HOME = {
  heading: "A CRM your agency can call its own",
  lead: `${PRODUCT} gives every client a private workspace for contacts, leads, deals, and tasks — under your brand, on your domain.`,
  cta: "Request a demo",
  secondary: "See the features",
  points: [
    {
      title: "One workspace per client",
      body: "Each client's records live in their own workspace. Access is checked on the server for every request.",
    },
    {
      title: "Your brand, everywhere",
      body: "Logo, colours, app name, sign-in page, and emails carry your brand. Colours are checked for readable contrast.",
    },
    {
      title: "Built for sales teams",
      body: "Leads convert to contacts, companies, and deals in one step. Move deals on a board, track tasks, and log calls.",
    },
  ],
};

export const FEATURES: Array<{ title: string; body: string; items: string[] }> = [
  {
    title: "Contacts and companies",
    body: "Keep people and organisations linked, with duplicate warnings for emails and domains.",
    items: [
      "Lifecycle stages from subscriber to customer",
      "Tags, owners, and filtered lists",
      "Customer view of contacts marked as customers",
    ],
  },
  {
    title: "Leads and deals",
    body: "Qualify leads, convert them in one step, and move deals through your pipeline.",
    items: [
      "Configurable pipeline with 2–15 open stages",
      "Board with drag-and-drop and a keyboard-friendly “Move to stage” control",
      "Won and lost outcomes with reasons",
    ],
  },
  {
    title: "Tasks and activity",
    body: "Never lose a follow-up: tasks with due dates in your time zone and a timeline of every call, meeting, and note.",
    items: [
      "“My tasks” grouped by overdue, today, and the next 7 days",
      "Due reminders in the app and by email",
      "Activity notes with safe formatting",
    ],
  },
  {
    title: "Reports and dashboard",
    body: "See pipeline value by stage, wins by month, lead-source conversion, and activity by person.",
    items: [
      "Accessible data tables behind every chart",
      "CSV export for managers",
      "Members see only their own numbers",
    ],
  },
  {
    title: "Import, export, and search",
    body: "Bring data in from a CSV file and take it out at any time.",
    items: [
      "CSV import of up to 10,000 rows with a preview and error report",
      "List export and full workspace export",
      "Search by the start of any word with Ctrl+K",
    ],
  },
  {
    title: "Teams and roles",
    body: "Invite your team with five roles: owner, admin, manager, member, and viewer.",
    items: [
      "Members see only the records they own",
      "Viewers can read but not change anything",
      "Audit log of changes for owners and admins",
    ],
  },
];

export const AGENCIES_PAGE = {
  heading: "Resell a CRM under your own brand",
  lead: "Create a workspace for each client, brand it, host it on your domain, and manage everything from the partner console.",
  steps: [
    {
      title: "Add a client",
      body: "Create a workspace and invite the client's owner. Their account is created when they accept.",
    },
    {
      title: "Brand it",
      body: "Set your logo, colours, and app name once; every client inherits them. Allow clients to customise if you choose.",
    },
    {
      title: "Connect a domain",
      body: "Serve a workspace on the client's domain or on your own agency domain. We show the DNS records to add.",
    },
    {
      title: "Watch usage",
      body: "See seats, records, plan, and active users per workspace. No access to your clients' CRM data.",
    },
  ],
  note: "Agency staff can't see client records unless a client invites them into their workspace — and the client can see that they did.",
};

export const PLANS_PAGE = {
  heading: "Plans",
  lead: "Every plan includes all core CRM features. Your agency partner sets the price in your currency.",
  rows: [
    ["Seats", "3", "5", "25", "Custom"],
    ["Records (contacts, companies, leads, deals)", "1,000", "10,000", "100,000", "Custom"],
    ["Rows per CSV import", "1,000", "10,000", "10,000", "Custom"],
    ["Reports and CSV import", "Yes", "Yes", "Yes", "Yes"],
    ["Audit log export", "No", "No", "Yes", "Yes"],
    ["Remove “Powered by” badge", "No", "No", "Yes*", "Yes*"],
  ] as Array<[string, string, string, string, string]>,
  columns: ["Trial (14 days)", "Starter", "Growth", "Enterprise"],
  footnote: "* When your agency's agreement also allows it.",
};

export const SECURITY_PAGE: Array<{ question: string; answer: string }> = [
  {
    question: "How is each client's data kept separate?",
    answer:
      "Every workspace has its own data space. The browser never reads the database directly; the server checks the workspace, your membership, and your role on every request.",
  },
  {
    question: "Who can see which records?",
    answer:
      "Owners, admins, managers, and viewers see the workspace's records; members see only records they own. Opening someone else's record by link shows “not found”.",
  },
  {
    question: "Is there an audit trail?",
    answer:
      "Changes to records, members, settings, and branding are written to an audit log at the same time as the change. Owners and admins can review it.",
  },
  {
    question: "How are sign-ins protected?",
    answer:
      "Sessions use secure, HTTP-only cookies scoped to each workspace address. Sensitive actions ask you to sign in again. You can sign out of every device at once.",
  },
  {
    question: "What privacy tools are included?",
    answer:
      "Admins can export all data about a contact or erase it permanently. Users can delete their own accounts. Owners can export or delete a whole workspace.",
  },
  {
    question: "Is data encrypted?",
    answer: "Data is encrypted in transit with TLS and encrypted at rest by the cloud database.",
  },
];

export const ABOUT_PAGE = {
  heading: `About ${PRODUCT}`,
  paragraphs: [
    "Agencies already help their clients find and win customers. Many want to give those clients a CRM too — under the agency's brand, with the agency in control of setup and support.",
    `${PRODUCT} is built for that: one platform, a separate workspace for each client, and white-label branding and domains from day one.`,
    "We focus on doing the basics well: clear data separation, accessible screens that work on a phone, and honest limits you can plan around.",
  ],
};

/** Contact form team-size options (shared by the form and the server schema). */
export const TEAM_SIZES = ["1-5", "6-20", "21-50", "51-200", "200+"] as const;

export const CONTACT_FORM = {
  heading: "Request a demo",
  intro:
    "Tell us about your agency and your clients. We reply within two business days with a walkthrough tailored to you.",
  name: "Your name",
  email: "Work email",
  company: "Agency or company",
  teamSize: "Team size",
  message: "What would you like to see? (optional)",
  website: "Leave this field empty",
  submit: "Request a demo",
  sending: "Sending…",
  thanks: "Thanks — we have your request and will be in touch soon.",
} as const;

export const FINDER_FORM = {
  heading: "Find your workspace",
  intro:
    "Workspaces live at their own addresses. Enter the email you sign in with and we'll email you the links.",
  email: "Email address",
  submit: "Email me my workspaces",
  sending: "Sending…",
  sent: "If that address belongs to any workspaces, a list of sign-in links is on its way. Check your inbox.",
} as const;
