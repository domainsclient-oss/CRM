import { handleImportUpload } from "@crm/core/data-http";

// CSV import upload (FR-IMP-001): CSRF header + Origin + session + import.run, ≤ 10 MB.
// PROTECTED FILE (requirements/08 §8).
export const POST = (request: Request) => handleImportUpload(request);
