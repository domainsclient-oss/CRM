import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConvertLeadButton,
  DealCloseButtons,
  DeleteRecordButton,
  ReassignButton,
  ReopenDealButton,
  TaskDoneToggle,
} from "./record-controls";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const actions = vi.hoisted(() => ({
  closeDealAction: vi.fn(),
  convertLeadAction: vi.fn(),
  deleteRecordAction: vi.fn(),
  reassignRecordAction: vi.fn(),
  reopenDealAction: vi.fn(),
  setTaskDoneAction: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => actions);
vi.mock("@crm/ui/lib/toast", () => ({ toast }));

const ok = <T,>(data: T) => ({ ok: true as const, data });
const denied = { ok: false as const, error: { code: "FORBIDDEN", message: "x", requestId: "r" } };

beforeEach(() => vi.clearAllMocks());

describe("record controls", () => {
  it("moves a record to trash after confirmation, then returns to the list", async () => {
    actions.deleteRecordAction.mockResolvedValue(ok({}));
    render(<DeleteRecordButton type="contact" id="ct_1" name="Dana" listHref="/contacts" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Move to trash" }));
    const dialog = await screen.findByRole("dialog", { name: "Move Dana to trash?" });
    await user.click(within(dialog).getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/contacts"));
    expect(actions.deleteRecordAction).toHaveBeenCalledWith({ type: "contact", id: "ct_1" });
  });

  it("keeps the dialog open and shows the server's refusal", async () => {
    actions.deleteRecordAction.mockResolvedValue(denied);
    render(<DeleteRecordButton type="contact" id="ct_1" name="Dana" listHref="/contacts" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Move to trash" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Move to trash" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/permission/);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("reassigns to the chosen member", async () => {
    actions.reassignRecordAction.mockResolvedValue(ok({}));
    render(
      <ReassignButton
        type="deal"
        id="dl_1"
        name="Big"
        current="u_raj"
        members={[
          { id: "u_raj", label: "Raj" },
          { id: "u_lena", label: "Lena" },
        ]}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Change owner" }));
    await user.selectOptions(await screen.findByLabelText("Owner"), "u_lena");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(actions.reassignRecordAction).toHaveBeenCalledWith({
        type: "deal",
        id: "dl_1",
        ownerUid: "u_lena",
      }),
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it("converts a lead into an existing contact, a new company and a deal", async () => {
    actions.convertLeadAction.mockResolvedValue(ok({ contactId: "ct_1" }));
    render(
      <ConvertLeadButton
        leadId="ld_1"
        name="Dana"
        companyName="Rivera Digital"
        matches={{ contact: { id: "ct_1", label: "Dana R" }, company: null }}
        currencyHint="USD"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Convert lead" }));
    await user.type(await screen.findByLabelText(/Deal amount|Amount/), "5000");
    await user.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/contacts/ct_1"));
    expect(actions.convertLeadAction).toHaveBeenCalledWith({
      leadId: "ld_1",
      contactId: "ct_1",
      company: { mode: "new" },
      deal: { name: "Rivera Digital deal", amount: "5000" },
    });
  });

  it("converts without a deal when unticked", async () => {
    actions.convertLeadAction.mockResolvedValue(ok({ contactId: "ct_2" }));
    render(
      <ConvertLeadButton
        leadId="ld_1"
        name="Dana"
        companyName={null}
        matches={{ contact: null, company: null }}
        currencyHint="USD"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Convert lead" }));
    await user.click(await screen.findByLabelText("Also create a deal"));
    await user.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(actions.convertLeadAction).toHaveBeenCalled());
    expect(actions.convertLeadAction.mock.calls[0]![0]).toMatchObject({
      contactId: null,
      company: { mode: "none" },
      deal: null,
    });
  });

  it("marks a deal won (with the customer stage) or lost with a reason", async () => {
    actions.closeDealAction.mockResolvedValue(ok({}));
    render(<DealCloseButtons id="dl_1" name="Big" hasContact />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mark won" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Mark won" }));
    await waitFor(() =>
      expect(actions.closeDealAction).toHaveBeenCalledWith({
        id: "dl_1",
        outcome: { outcome: "won", markContactCustomer: true },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Mark lost" }));
    dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Details"), "Went with a competitor");
    await user.click(within(dialog).getByRole("button", { name: "Mark lost" }));
    await waitFor(() => expect(actions.closeDealAction).toHaveBeenCalledTimes(2));
    expect(actions.closeDealAction.mock.calls[1]![0]).toMatchObject({
      outcome: { outcome: "lost", lostReasonText: "Went with a competitor" },
    });
  });

  it("reopens a deal into the chosen stage", async () => {
    actions.reopenDealAction.mockResolvedValue(ok({}));
    render(
      <ReopenDealButton
        id="dl_1"
        name="Big"
        stages={[
          { id: "stg_a", label: "A" },
          { id: "stg_b", label: "B" },
        ]}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Stage"), "stg_b");
    await user.click(within(dialog).getByRole("button", { name: "Reopen" }));
    await waitFor(() =>
      expect(actions.reopenDealAction).toHaveBeenCalledWith({ id: "dl_1", stageId: "stg_b" }),
    );
  });

  it("completes a task optimistically and offers undo", async () => {
    actions.setTaskDoneAction.mockResolvedValue(ok({}));
    render(<TaskDoneToggle id="tk_1" title="Call" done={false} />);
    const user = userEvent.setup();
    const box = screen.getByRole("checkbox", { name: "Mark Call done" });
    await user.click(box);
    expect(box).toBeChecked();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [message, opts] = toast.success.mock.calls[0]! as [
      string,
      { action: { onClick: () => Promise<void> } },
    ];
    expect(message).toBe("Task completed.");
    await opts.action.onClick();
    expect(actions.setTaskDoneAction).toHaveBeenLastCalledWith({ id: "tk_1", done: false });
  });

  it("reverts the checkbox when the server refuses", async () => {
    actions.setTaskDoneAction.mockResolvedValue(denied);
    render(<TaskDoneToggle id="tk_1" title="Call" done={false} />);
    const user = userEvent.setup();
    const box = screen.getByRole("checkbox", { name: "Mark Call done" });
    await user.click(box);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(box).not.toBeChecked();
  });
});
