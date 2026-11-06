// Integration tests run inside `firebase emulators:exec` (auth + firestore).
// Fail fast if the emulators are not configured, so nothing can touch a real project.
for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
  if (!process.env[name]) {
    throw new Error(`${name} missing — run integration tests with \`pnpm test:integration\``);
  }
}

process.env.FIREBASE_PROJECT_ID = "demo-crm";
process.env.GCLOUD_PROJECT = "demo-crm";
process.env.APP_ENV = "test";
process.env.APP_PLATFORM_STAFF_DOMAINS = "example.com";
process.env.APP_MARKETING_HOST = "www.localhost:3000";
process.env.APP_CONSOLE_HOST = "console.localhost:3001";
process.env.APP_PARTNERS_HOST = "partners.localhost:3001";
process.env.LOG_LEVEL = "error";
process.env.FIREBASE_STORAGE_BRAND_BUCKET = "demo-crm-brand-assets";
process.env.FIREBASE_STORAGE_PRIVATE_BUCKET = "demo-crm-private";
// Never use real credentials in tests, even if the developer's shell has them.
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
