import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test/axe";
import { ActionError } from "./action-feedback";
import { BaseDomainForm, ConsoleBranding, PlanEditor, StaffManager } from "./admin-forms";
import { CreateAgencyForm, CreateWorkspaceForm } from "./create-forms";
import { DomainsManager, type DomainRow } from "./domains-manager";
import { ReportCsvButton } from "./report-csv-button";
import { SignInForm } from "./sign-in-form";
import { StatusButton } from "./status-button";
import { AgenciesTable, WorkspacesTable } from "./tables";

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const auth = vi.hoisted(() => ({ signInWithGoogle: vi.fn(), signInWithPassword: vi.fn() }));
const editor = vi.hoisted(() => ({
  props: null as null | Record<string, (...a: unknown[]) => unknown>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@crm/ui/lib/toast", () => ({ toast }));
vi.mock("@crm/shared/auth-client", () => auth);
vi.mock("@crm/ui/components/branding-editor", () => ({
  BrandingEditor: (props: Record<string, (...a: unknown[]) => unknown>) => {
    editor.props = props;
    return null;
  },
}));

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (code = "FORBIDDEN", fieldErrors?: Record<string, string[]>) => ({
  ok: false as const,
  error: { code, message: "x", requestId: "r", fieldErrors },
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("SignInForm (FR-AUTH-008)", () => {
  it("platform staff get Google only; success goes home", async () => {
    auth.signInWithGoogle.mockResolvedValue({ ok: true });
    render(<SignInForm title="Platform" body="b" allowPassword={false} notice="Signed out" />);
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Signed out");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  it("agency staff can use a password; failures are announced", async () => {
    auth.signInWithPassword.mockResolvedValue({ ok: false, reason: "invalid_credentials" });
    const { container } = render(<SignInForm title="Partners" body="b" allowPassword />);
    await expectNoA11yViolations(container);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "priya@agency.test");
    await user.type(screen.getByLabelText("Password"), "secret-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(auth.signInWithPassword).toHaveBeenCalledWith("priya@agency.test", "secret-pass");
  });
});

describe("create forms (FR-TEN-001 AC4)", () => {
  it("creates an agency with one idempotency key per form instance", async () => {
    const action = vi.fn().mockResolvedValue(ok({ agencyId: "agy_1" }));
    render(<CreateAgencyForm action={action} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Name"), "Agency Three");
    await user.type(screen.getByLabelText(/Short name/), "agency-three");
    await user.type(screen.getByLabelText("Owner email"), "o@a3.test");
    await user.click(screen.getByLabelText("Agency staff may create workspaces"));
    await user.click(screen.getByRole("button", { name: "Create agency" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Agency created/);
    const input = action.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({
      name: "Agency Three",
      slug: "agency-three",
      canProvisionWorkspaces: true,
      maxWorkspaces: "10",
    });
    expect(input.idempotencyKey).toMatch(/^[0-9a-f]{32}$/);
    await user.type(screen.getByLabelText("Name"), "Another");
    await user.click(screen.getByRole("button", { name: "Create agency" }));
    expect((action.mock.calls[1]![0] as Record<string, unknown>).idempotencyKey).not.toBe(
      input.idempotencyKey,
    );
  });

  it("creates a workspace for a chosen agency and shows field errors", async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce(fail("VALIDATION", { slug: ["Already taken"] }))
      .mockResolvedValueOnce(ok({ tenantId: "t", host: "acme.app.test" }));
    render(<CreateWorkspaceForm action={action} agencies={[{ id: "agy_1", name: "One" }]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(await screen.findByText("Already taken")).toBeInTheDocument();
    expect(screen.getByLabelText(/Short name/)).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(await screen.findByRole("status")).toHaveTextContent("acme.app.test");
    expect(action.mock.calls[0]![0]).toMatchObject({ agencyId: "agy_1" });
  });
});

describe("DomainsManager (FR-TEN-005)", () => {
  const domains: DomainRow[] = [
    {
      host: "acme.app.test",
      type: "platform_subdomain",
      status: "active",
      isCanonical: false,
      records: [],
      error: null,
    },
    {
      host: "crm.acme.com",
      type: "custom",
      status: "pending_dns",
      isCanonical: false,
      records: [{ type: "CNAME", name: "crm", value: "cname.vercel-dns.com" }],
      error: null,
    },
  ];
  const actions = () => ({
    add: vi.fn().mockResolvedValue(ok({})),
    check: vi.fn().mockResolvedValue(ok({ status: "active" })),
    setCanonical: vi.fn().mockResolvedValue(ok({})),
    remove: vi.fn().mockResolvedValue(fail("REAUTH_REQUIRED")),
    addSubdomain: vi.fn().mockResolvedValue(ok({})),
  });

  it("shows DNS records and runs each step", async () => {
    const a = actions();
    render(<DomainsManager tenantId="t1" domains={domains} actions={a} />);
    const user = userEvent.setup();
    expect(
      within(screen.getByRole("region", { name: "DNS records for crm.acme.com" })).getByText(
        "cname.vercel-dns.com",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove acme.app.test" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check crm.acme.com" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Status: Active."));
    await user.click(screen.getByRole("button", { name: "Make acme.app.test the main address" }));
    expect(a.setCanonical).toHaveBeenCalledWith({ tenantId: "t1", host: "acme.app.test" });

    await user.click(screen.getByRole("button", { name: "Remove crm.acme.com" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Domain"), "crm.globex.com");
    await user.click(screen.getByRole("button", { name: "Add domain" }));
    await waitFor(() =>
      expect(a.add).toHaveBeenCalledWith({ tenantId: "t1", host: "crm.globex.com" }),
    );
    await user.click(screen.getByRole("button", { name: "Add agency subdomain" }));
    expect(a.addSubdomain).toHaveBeenCalledWith({ tenantId: "t1" });
  });

  it("shows host validation errors", async () => {
    const a = actions();
    a.add.mockResolvedValue(fail("VALIDATION", { host: ["This domain belongs to the platform"] }));
    render(<DomainsManager tenantId="t1" domains={[]} actions={a} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Domain"), "console.example.com");
    await user.click(screen.getByRole("button", { name: "Add domain" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("belongs to the platform");
  });
});

describe("admin forms", () => {
  it("PlanEditor submits plan, overrides and flags", async () => {
    const action = vi.fn().mockResolvedValueOnce(ok({})).mockResolvedValueOnce(fail());
    render(
      <PlanEditor
        tenantId="t1"
        planId="trial"
        plans={["trial", "pro"]}
        overrides={{ seats: null, records: 500 }}
        flags={{ globalSearch: true, bulkActions: false }}
        action={action}
      />,
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Plan"), "pro");
    await user.type(screen.getByLabelText("Seat limit override"), "25");
    await user.click(screen.getByLabelText("Bulk actions"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Plan updated."));
    expect(action).toHaveBeenCalledWith({
      tenantId: "t1",
      planId: "pro",
      seats: "25",
      records: "500",
      flags: { globalSearch: true, bulkActions: true },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("StaffManager lists staff and invites by email", async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce(fail("VALIDATION", { email: ["Enter a valid email"] }))
      .mockResolvedValueOnce(ok({ email: "new@agency.test" }));
    render(
      <StaffManager
        staff={[{ uid: "u1", email: "p@a.test", displayName: "Priya", role: "agency_owner" }]}
        pending={[{ id: "i1", email: "later@a.test" }]}
        canInvite
        action={action}
      />,
    );
    expect(screen.getByText("Pending: later@a.test")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Invite admin" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email");
    await user.type(screen.getByLabelText("Email"), "new@agency.test");
    await user.click(screen.getByRole("button", { name: "Invite admin" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Invitation sent to new@agency.test."),
    );
  });

  it("StaffManager hides the invite form without the permission", () => {
    render(<StaffManager staff={[]} pending={[]} canInvite={false} action={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Invite admin" })).not.toBeInTheDocument();
  });

  it("BaseDomainForm saves or shows the host error", async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce(fail("VALIDATION", { host: ["Enter a domain"] }))
      .mockResolvedValueOnce(ok({}));
    render(<BaseDomainForm value={null} action={action} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a domain");
    await user.type(screen.getByLabelText("Agency base domain"), "crm.agency.test");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(action).toHaveBeenLastCalledWith({ host: "crm.agency.test" });
  });

  it("ConsoleBranding targets the workspace when given one", () => {
    const actions = { save: vi.fn(), upload: vi.fn(), remove: vi.fn() };
    render(
      <ConsoleBranding
        tenantId="t1"
        own={{ appName: null, primaryColor: null, accentColor: null }}
        inherited={{ appName: "A", primaryColor: "#000000", accentColor: "#000000" }}
        assets={{ logoLight: null, logoDark: null, favicon: null }}
        actions={actions}
      />,
    );
    const file = new File(["x"], "a.png");
    editor.props!.onSave!({ appName: "X" });
    editor.props!.onUpload!("favicon", file);
    editor.props!.onRemove!("favicon");
    editor.props!.onChanged!();
    expect(actions.save).toHaveBeenCalledWith({ tenantId: "t1", appName: "X" });
    expect(actions.upload).toHaveBeenCalledWith({ tenantId: "t1", kind: "favicon", file });
    expect(actions.remove).toHaveBeenCalledWith({ tenantId: "t1", kind: "favicon" });
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe("tables and status (FR-AGY-001, FR-TEN-002)", () => {
  it("suspends and reactivates rows", async () => {
    const setStatus = vi.fn().mockResolvedValueOnce(ok({})).mockResolvedValueOnce(fail());
    render(
      <>
        <AgenciesTable
          agencies={[
            { id: "a1", name: "One", status: "active", workspaces: 1, maxWorkspaces: 5 } as never,
          ]}
          setStatus={setStatus}
        />
        <WorkspacesTable
          workspaces={[
            {
              id: "t1",
              name: "Acme",
              agencyId: "a1",
              host: "acme.test",
              status: "suspended",
            } as never,
          ]}
          agencyNames={{ a1: "One" }}
          setStatus={setStatus}
        />
      </>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Suspend: One" }));
    expect(setStatus).toHaveBeenCalledWith({ agencyId: "a1", status: "suspended" });
    await user.click(screen.getByRole("button", { name: "Reactivate: Acme" }));
    expect(setStatus).toHaveBeenLastCalledWith({ tenantId: "t1", status: "active" });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute("href", "/workspaces/t1");
  });

  it("shows empty states and hides buttons for other statuses", () => {
    render(
      <>
        <AgenciesTable agencies={[]} setStatus={vi.fn()} />
        <StatusButton
          label="x"
          status="pending_deletion"
          action={vi.fn()}
          idField="tenantId"
          id="t"
        />
      </>,
    );
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ActionError offers sign-in for re-auth failures", () => {
    render(<ActionError result={fail("REAUTH_REQUIRED") as never} />);
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/login");
  });

  it("ReportCsvButton downloads the report or reports the error", async () => {
    const clicks: string[] = [];
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    const action = vi
      .fn()
      .mockResolvedValueOnce(ok({ csv: "a" }))
      .mockResolvedValueOnce(fail());
    render(<ReportCsvButton action={action} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(clicks).toEqual(["usage-report.csv"]));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
