// One-off bootstrap: make an existing Firebase Auth user the first platform super admin
// (FR-AUTH-008). Later admins are managed from the platform console. Refuses production unless
// --i-understand-production is passed, and refuses if --project doesn't match the configured one.
//
// The person must have signed in once at the platform console with Google (that creates the Auth
// user; the console will say "no access" until this runs).
//
//   pnpm admin:bootstrap --email you@example.com --project <firebase-project-id>
import { parseArgs } from "node:util";
import { FieldValue } from "firebase-admin/firestore";
import { auditNow } from "../packages/core/src/audit";
import { allowedStaffDomains } from "../packages/core/src/contexts/platform-context";
import { getAdminAuth, getDb } from "../packages/core/src/firebase-admin";
import { getServerEnv } from "../packages/core/src/server-env";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    project: { type: "string" },
    "i-understand-production": { type: "boolean", default: false },
  },
});

async function main() {
  const env = getServerEnv();
  if (!values.email || !values.project) throw new Error("Required: --email --project");
  if (values.project !== env.FIREBASE_PROJECT_ID) {
    throw new Error(`--project ${values.project} doesn't match FIREBASE_PROJECT_ID`);
  }
  if (env.APP_ENV === "production" && !values["i-understand-production"]) {
    throw new Error("Production: re-run with --i-understand-production");
  }
  const email = values.email.toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (!allowedStaffDomains().includes(domain)) {
    throw new Error(
      `${domain} isn't in APP_PLATFORM_STAFF_DOMAINS — add it there first (console project too)`,
    );
  }
  const user = await getAdminAuth()
    .getUserByEmail(email)
    .catch(() => null);
  if (!user) {
    throw new Error(
      "No Auth user with that email. Sign in once at the platform console with Google first.",
    );
  }
  await getDb()
    .doc(`platformAdmins/${user.uid}`)
    .set({ role: "superadmin", email, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  await auditNow(
    { platform: true },
    {
      action: "platform.admin_bootstrapped",
      actor: { type: "system" },
      target: { type: "user", id: user.uid },
      requestId: "bootstrap",
    },
  );
  console.log(`Done: ${email} is a platform superadmin. Sign in again at the platform console.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
