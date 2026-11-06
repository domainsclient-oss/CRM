"use client";

import { ErrorView } from "@crm/ui/components/error-view";

// Segment error boundary (06 §9): the app shell (navigation) stays usable; the page area shows a
// plain-language error with retry and a support reference.
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorView digest={error.digest} onRetry={retry} />;
}
