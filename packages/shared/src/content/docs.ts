// Help centre content (FR-PUB-002, requirements/07 §4). Question-led titles; the summary answers
// in ≤ 50 words; sections follow Summary · Steps · Limits · Troubleshooting · Related.

export interface DocArticle {
  slug: string;
  title: string; // a real question
  summary: string; // direct answer, ≤ 50 words
  steps: string[];
  limits: string[];
  troubleshooting: Array<[problem: string, fix: string]>;
  related: string[]; // slugs
  updated: string;
}

export const DOCS: DocArticle[] = [
  {
    slug: "import-contacts-csv",
    title: "How do I import contacts from a CSV file?",
    summary:
      "Go to Settings → Import, choose Contacts, upload a UTF-8 CSV file, check the column matches and the preview, choose what to do with duplicates, and start the import. You'll get a notification and an error report for rows that were skipped.",
    steps: [
      "Open Settings → Import. Managers, admins, and owners can import.",
      "Choose Contacts, Companies, or Leads, select your CSV file, and select “Upload and preview”.",
      "Check the suggested field for each column; change any that are wrong or choose “Don't import”.",
      "Review the preview of the first 50 rows and the number of rows with problems.",
      "Choose what happens when a matching record exists: skip the row, update the existing record, or create a new one.",
      "Select “Import”. You can leave the page; a notification tells you when it's finished.",
    ],
    limits: [
      "Files up to 10 MB and 10,000 rows, UTF-8 encoded, separated by commas or semicolons.",
      "Contacts match on email address; companies match on web domain.",
      "Imports count toward your plan's record limit; an import that would exceed it doesn't start.",
    ],
    troubleshooting: [
      [
        "“Save the file as UTF-8 CSV”",
        "Re-save the spreadsheet as “CSV UTF-8” and upload it again.",
      ],
      [
        "Some rows were skipped",
        "Download the error report from the import list; it lists each row number and the reason.",
      ],
      ["Duplicates were skipped", "Import again and choose “Update the existing record”."],
    ],
    related: ["export-data", "roles-and-permissions"],
    updated: "2026-10-10",
  },
  {
    slug: "export-data",
    title: "How do I export my data?",
    summary:
      "Managers and above can export any list as a CSV file from the list page. Owners can export the whole workspace from Settings → Import. Downloads are available for 24 hours from the import and export list.",
    steps: [
      "Open the list you want (for example Contacts) and apply a filter if needed.",
      "Select “Export CSV”. The export runs in the background.",
      "Open Settings → Import and download the file when it's ready.",
      "Owners: select “Export all workspace data” for a full copy.",
    ],
    limits: [
      "List exports include up to 50,000 rows.",
      "Cells that a spreadsheet could treat as formulas are prefixed with an apostrophe for safety.",
      "Download links expire 24 hours after the export finishes.",
    ],
    troubleshooting: [
      ["The download link is missing", "The 24-hour window has passed; run the export again."],
    ],
    related: ["import-contacts-csv"],
    updated: "2026-10-10",
  },
  {
    slug: "pipeline-and-deals",
    title: "How do I move a deal to another stage?",
    summary:
      "Open Pipeline and drag the deal card to another column, or use the “Move to stage” menu on the card. The move is saved immediately and recorded in the deal's activity.",
    steps: [
      "Open Pipeline from the navigation.",
      "Drag the card to the new stage, or choose a stage in the card's “Move to stage” menu.",
      "To close a deal, open it and select “Mark won” or “Mark lost” (a reason is required for lost deals).",
    ],
    limits: [
      "Each column shows the 20 most recently updated deals; use the list view to see all.",
      "Only owners and admins can change the pipeline's stages (Settings → Pipeline).",
      "Reopening a closed deal requires a manager, admin, or owner.",
    ],
    troubleshooting: [
      [
        "The card moved back",
        "The change couldn't be saved — check your connection and that you own the deal.",
      ],
    ],
    related: ["roles-and-permissions"],
    updated: "2026-10-10",
  },
  {
    slug: "roles-and-permissions",
    title: "What can each role do?",
    summary:
      "Owners and admins manage the workspace and team. Managers work with all records. Members work only with records they own. Viewers can read everything but change nothing.",
    steps: [
      "Owners: everything, including billing, workspace export and deletion, and transferring ownership.",
      "Admins: team, settings, branding, pipeline, audit log, and privacy tools.",
      "Managers: all records, reassigning owners, imports, exports, and the trash.",
      "Members: create records and work with the ones they own.",
      "Viewers: read-only access to the workspace's records and reports.",
    ],
    limits: [
      "Admins can invite and manage people up to the manager role.",
      "A workspace always has exactly one owner.",
    ],
    troubleshooting: [
      [
        "A record shows “not found”",
        "It belongs to someone else and you're a member — ask a manager to reassign it.",
      ],
    ],
    related: ["pipeline-and-deals"],
    updated: "2026-10-10",
  },
  {
    slug: "branding",
    title: "How do I change the logo and colours?",
    summary:
      "Owners and admins open Settings → Branding, set the app name and colours, and upload logos and a favicon. If the options are locked, your agency manages branding for you.",
    steps: [
      "Open Settings → Branding.",
      "Enter an app name and hex colours; the preview shows light and dark mode.",
      "Upload a logo for light backgrounds, optionally one for dark backgrounds, and a favicon.",
      "Select “Save”. Everyone sees the change within a minute.",
    ],
    limits: [
      "Logos: PNG, JPEG, or WebP up to 1 MB and 2048×2048 pixels. Favicons: PNG up to 256 KB. SVG isn't accepted.",
      "Colours that can't meet readable contrast are refused, with a suggested alternative.",
    ],
    troubleshooting: [
      [
        "The settings are read-only",
        "Your agency has kept branding under its control; contact them.",
      ],
    ],
    related: ["custom-domains"],
    updated: "2026-10-10",
  },
  {
    slug: "custom-domains",
    title: "Can my workspace use our own domain?",
    summary:
      "Yes. Your agency or the platform team adds the domain, you create the DNS records they give you, and once it's verified it can become the workspace's main address.",
    steps: [
      "Ask your agency to add the domain (for example crm.yourcompany.com).",
      "Create the DNS records shown to you at your DNS provider.",
      "After verification, the domain becomes active and can be made the main address.",
      "Everyone signs in once on the new address; the old address redirects.",
    ],
    limits: [
      "A domain can belong to only one workspace.",
      "Subdomains are recommended; root domains need an A record.",
    ],
    troubleshooting: [
      [
        "Still “Verifying”",
        "DNS changes can take time to appear. Check that the records match exactly.",
      ],
    ],
    related: ["branding"],
    updated: "2026-10-10",
  },
  {
    slug: "privacy-requests",
    title: "How do I handle a data request from a contact?",
    summary:
      "Admins open Settings → Privacy, choose the contact, and select “Export contact data” for a copy, or “Erase contact” to delete it permanently. Erasure can't be undone and asks you to sign in again.",
    steps: [
      "Open Settings → Privacy.",
      "Choose the contact.",
      "Export: downloads a JSON and a CSV file with the contact, its activities, deals, and tasks.",
      "Erase: deletes the contact and its activities now and replaces its name on deals and tasks with “[erased]”.",
    ],
    limits: ["Erasure skips the 30-day trash.", "Only owners and admins can use privacy tools."],
    troubleshooting: [
      [
        "“Please confirm your password”",
        "Sign in again, then repeat the erasure within five minutes.",
      ],
    ],
    related: ["export-data"],
    updated: "2026-10-10",
  },
];

export const FAQ: Array<[question: string, answer: string]> = [
  [
    "Can I sign up on my own?",
    "No. Workspaces are created by your agency or the platform team, who invite the first owner.",
  ],
  [
    "Can my agency see my customers?",
    "No. Agency staff see usage numbers only, unless you invite them into your workspace — and you'll see them in your team list.",
  ],
  [
    "Where is my data stored?",
    "In a cloud database in the region chosen for your deployment. Ask your agency which region applies to you.",
  ],
  [
    "Can I get all my data out?",
    "Yes. Owners can export the whole workspace at any time, and managers can export lists as CSV.",
  ],
  [
    "What happens when I delete a record?",
    "It moves to the trash for 30 days. Managers can restore it during that time; after that it's deleted permanently.",
  ],
  [
    "Does it work on my phone?",
    "Yes. Every screen works in a phone browser, including the pipeline board and importing.",
  ],
  [
    "How do I find my workspace's address?",
    "Use “Find your workspace” and enter your email; we'll email you the addresses of your workspaces.",
  ],
];

export const GLOSSARY: Array<[term: string, definition: string]> = [
  [
    "Workspace",
    "A private space for one client organisation, with its own records, team, branding, and address.",
  ],
  ["Lead", "A person who might become a customer and hasn't been qualified yet."],
  ["Contact", "A person you have a relationship with, optionally linked to a company."],
  ["Customer", "A contact whose lifecycle stage is “customer”."],
  ["Company", "An organisation that contacts and deals can belong to."],
  ["Deal", "A potential sale with an amount, a stage, and an expected close date."],
  ["Pipeline", "The ordered stages a deal moves through until it's won or lost."],
  [
    "Lifecycle stage",
    "Where a contact is in their relationship with you: subscriber, lead, opportunity, customer, churned, or other.",
  ],
  [
    "Owner (of a record)",
    "The team member responsible for a record; members see only records they own.",
  ],
  ["Agency", "A partner that resells the CRM to clients and manages their workspaces."],
];

/** Legal pages are drafts pending legal review (marked on the page). */
export const LEGAL_NOTICE =
  "Draft for legal review — this text will be replaced by the operator's final policy before launch.";

export const LEGAL: Record<
  "privacy" | "terms" | "cookies",
  Array<[heading: string, body: string]>
> = {
  privacy: [
    [
      "Who we are",
      "The operator of this service is the data processor for workspace data and the controller for account data. Contact details will be listed here.",
    ],
    [
      "What we collect",
      "Account details (name, email), workspace content entered by users, and technical logs needed to run and secure the service.",
    ],
    [
      "How we use it",
      "To provide the service, keep it secure, and send transactional emails. We don't sell personal data.",
    ],
    [
      "Your rights",
      "You can access, correct, export, or delete your data. Workspace admins can export or erase contact data on request.",
    ],
    [
      "Retention",
      "Deleted records are kept in the trash for 30 days; audit logs for up to 365 days; deleted workspaces are purged after 30 days.",
    ],
  ],
  terms: [
    [
      "The service",
      "A customer relationship management service provided to agencies and their client workspaces.",
    ],
    [
      "Accounts",
      "Accounts are created by invitation. Keep your password secure and tell us about suspected misuse.",
    ],
    [
      "Acceptable use",
      "Don't use the service to send spam, store unlawful content, or attempt to access other workspaces.",
    ],
    ["Data", "You keep ownership of the data you enter. You can export it at any time."],
  ],
  cookies: [
    [
      "Essential cookies",
      "A session cookie keeps you signed in to each workspace address. It's HTTP-only and can't be read by scripts.",
    ],
    [
      "Preferences",
      "A small number of settings (such as the selected agency in the partner console) are stored in cookies.",
    ],
    [
      "Analytics",
      "Public pages may report anonymous performance measurements (page speed). No advertising cookies are used.",
    ],
  ],
};
