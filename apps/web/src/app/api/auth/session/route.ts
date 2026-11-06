import { handleCreateSession, handleDeleteSession } from "@crm/core/session-http";

// Session exchange for workspace hosts (FR-AUTH-004/006). Logic and CSRF checks live in
// @crm/core/session-http so they are shared and tested. PROTECTED FILE.
export const POST = (request: Request) => handleCreateSession(request);
export const DELETE = (request: Request) => handleDeleteSession(request);
