// Base messages (NFR-I18N-001): the small set that error boundaries, the 404 page and public
// forms need. Split out so pages that only need these don't ship the whole catalog (TC-PERF-001).

export const enBase = {
  "common.appName": "CRM",
  "common.loading": "Loading…",
  "common.retry": "Try again",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.close": "Close",
  "common.skipToContent": "Skip to main content",
  "common.supportReference": "Support reference: {requestId}",
  "common.backHome": "Go to home page",
  "error.UNAUTHENTICATED": "Please sign in to continue.",
  "error.FORBIDDEN": "You don't have permission to do that.",
  "error.NOT_FOUND": "We couldn't find what you were looking for.",
  "error.VALIDATION": "Please check the highlighted fields.",
  "error.CONFLICT": "This record changed since you opened it. Reload to see the latest version.",
  "error.RATE_LIMITED": "Too many requests. Please wait a moment and try again.",
  "error.PLAN_LIMIT_EXCEEDED": "Your plan's limit has been reached.",
  "error.TENANT_SUSPENDED": "This workspace is suspended.",
  "error.BILLING_READ_ONLY": "This workspace is read-only until the subscription is renewed.",
  "error.REAUTH_REQUIRED": "Please confirm your password to continue.",
  "error.INTERNAL": "Something went wrong on our side.",
  "page.error.title": "Something went wrong",
  "page.error.body": "An unexpected error occurred. You can try again.",
  "page.notFound.title": "Page not found",
  "page.notFound.body": "The page you're looking for doesn't exist or you don't have access to it.",
} as const;

export type BaseMessageKey = keyof typeof enBase;
