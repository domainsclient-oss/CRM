import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditExportButton, AuditFilters } from "./audit-controls";
import { CsvButton } from "./csv-button";
import {
  CancelDeletionButton,
  DeleteAccount,
  DeleteWorkspace,
  TenantExportButton,
} from "./danger-zone";
import { NotificationPrefsForm } from "./notification-prefs";
import { PrivacyTools } from "./privacy-tools";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
const actions = vi.hoisted(() => ({
  auditExportAction: vi.fn(),
  cancelTenantDeletionAction: vi.fn(),
  deleteAccountAction: vi.fn(),
  eraseContactAction: vi.fn(),
  exportContactDataAction: vi.fn(),
  exportTenantAction: vi.fn(),
  requestTenantDeletionAction: vi.fn(),
  updateNotificationPrefsAction: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => actions);
vi.mock("@crm/ui/lib/toast", () => ({ toast }));

const ok = { ok: true as const, data: {} };
const fail = (code: string) => ({
  ok: false as const,
  error: { code, message: "x", requestId: "r" },
});
const downloads: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  downloads.length = 0;
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("danger zone (FR-TEN-006, FR-PRIV-003)", () => {
  it("only enables workspace deletion once the slug is typed", async () => {
    actions.requestTenantDeletionAction.mockResolvedValue(ok);
    render(<DeleteWorkspace slug="acme" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete workspace" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete workspace" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type the workspace short name/), "acme");
    await user.click(confirm);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(actions.requestTenantDeletionAction).toHaveBeenCalledWith({ confirmSlug: "acme" });
  });

  it("shows refusals for deletion, cancellation and export", async () => {
    actions.requestTenantDeletionAction.mockResolvedValue(fail("FORBIDDEN"));
    actions.cancelTenantDeletionAction.mockResolvedValue(fail("FORBIDDEN"));
    actions.exportTenantAction.mockResolvedValue(fail("RATE_LIMITED"));
    render(
      <>
        <DeleteWorkspace slug="a" />
        <CancelDeletionButton />
        <TenantExportButton />
      </>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel deletion" }));
    await user.click(screen.getByRole("button", { name: "Export all workspace data" }));
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Delete workspace" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "a");
    await user.click(within(dialog).getByRole("button", { name: "Delete workspace" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
  });

  it("cancels deletion and starts a tenant export", async () => {
    actions.cancelTenantDeletionAction.mockResolvedValue(ok);
    actions.exportTenantAction.mockResolvedValue(ok);
    render(
      <>
        <CancelDeletionButton />
        <TenantExportButton />
      </>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel deletion" }));
    await user.click(screen.getByRole("button", { name: "Export all workspace data" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
  });

  it("deletes the account, or explains the sole-owner rule", async () => {
    actions.deleteAccountAction.mockResolvedValueOnce(fail("CONFLICT")).mockResolvedValueOnce(ok);
    render(<DeleteAccount />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete my account" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/You own a workspace/);
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  });
});

describe("privacy tools (FR-PRIV-001/002)", () => {
  const contacts = [
    { id: "ct_1", label: "Dana" },
    { id: "ct_2", label: "Lee" },
  ];

  it("exports a contact's data as JSON and CSV", async () => {
    actions.exportContactDataAction.mockResolvedValue({ ok: true, data: { json: "{}", csv: "a" } });
    render(<PrivacyTools contacts={contacts} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Contact"), "ct_2");
    await user.click(screen.getByRole("button", { name: "Export contact data" }));
    await waitFor(() => expect(downloads).toEqual(["contact-ct_2.json", "contact-ct_2.csv"]));
  });

  it("erases after confirmation and asks for re-authentication when required", async () => {
    actions.eraseContactAction
      .mockResolvedValueOnce(fail("REAUTH_REQUIRED"))
      .mockResolvedValueOnce(ok);
    render(<PrivacyTools contacts={contacts} />);
    const user = userEvent.setup();
    const erase = async () => {
      await user.click(screen.getByRole("button", { name: "Erase contact" }));
      const dialog = await screen.findByRole("dialog", { name: "Erase Dana permanently?" });
      await user.click(within(dialog).getByRole("button", { name: "Erase contact" }));
    };
    await erase();
    expect(await screen.findByRole("alert")).toHaveTextContent(/sign in again/);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
    await erase();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Contact erased."));
  });
});

describe("audit controls (FR-AUD-002)", () => {
  it("builds the filter URL from the chosen action or actor and dates", async () => {
    render(
      <AuditFilters
        actions={["record.created", "member.removed"]}
        members={{ u_raj: "Raj" }}
        current={{ action: null, actorUid: "u_raj", from: null, to: null }}
      />,
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/Action/), "action:member.removed");
    await user.type(screen.getByLabelText("From"), "2026-10-01");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(router.push).toHaveBeenCalledWith(
      "/settings/audit?action=member.removed&from=2026-10-01",
    );
    await user.selectOptions(screen.getByLabelText(/Action/), "");
    await user.clear(screen.getByLabelText("From"));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(router.push).toHaveBeenLastCalledWith("/settings/audit");
  });

  it("downloads the audit export or reports an error", async () => {
    actions.auditExportAction
      .mockResolvedValueOnce({ ok: true, data: { csv: "a,b" } })
      .mockResolvedValueOnce(fail("FORBIDDEN"));
    const filter = { action: null, actorUid: null, from: null, to: null };
    render(<AuditExportButton filter={filter} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(downloads).toEqual(["audit-log.csv"]));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("CsvButton serializes rows", async () => {
    render(<CsvButton name="r.csv" header={["a"]} rows={[["=1"]]} label="Download" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Download" }));
    expect(downloads).toEqual(["r.csv"]);
  });
});

describe("notification preferences (FR-NOTF-002)", () => {
  it("toggles channels per event and saves", async () => {
    actions.updateNotificationPrefsAction
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(fail("INTERNAL"));
    render(<NotificationPrefsForm initial={{ record_assigned: { inApp: true, email: true } }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Email: Assigned to you" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(actions.updateNotificationPrefsAction).toHaveBeenCalledWith({
        prefs: { record_assigned: { inApp: true, email: false } },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Notification preferences saved.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
