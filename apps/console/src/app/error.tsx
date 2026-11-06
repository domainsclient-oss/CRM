"use client";

import { ErrorView } from "@crm/ui/components/error-view";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorView digest={error.digest} onRetry={retry} />;
}
