import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIST_ENTITIES } from "@crm/shared/records/list-specs";
import { expectNoA11yViolations } from "../../../../../test/axe";
import { RecordForm, type FormOptionsProps } from "./record-form";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
const actions = vi.hoisted(() => ({
  checkDuplicateAction: vi.fn(),
  saveCompanyAction: vi.fn(),
  saveContactAction: vi.fn(),
  saveDealAction: vi.fn(),
  saveLeadAction: vi.fn(),
  saveTaskAction: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => actions);
vi.mock("@crm/ui/lib/toast", () => ({ toast }));

const options: FormOptionsProps = {
  members: [{ id: "u_raj", label: "Raj" }],
  companies: [{ id: "co_1", label: "Acme Corp" }],
  contacts: [{ id: "ct_1", label: "Dana Rivera" }],
  leads: [{ id: "ld_1", label: "Lead One" }],
  deals: [{ id: "dl_1", label: "Big Deal" }],
  stages: [{ id: "stg_new", label: "New" }],
  tags: ["vip"],
  canReassign: true,
};

function renderForm(
  entity: (typeof LIST_ENTITIES)[number],
  extra: Partial<Parameters<typeof RecordForm>[0]> = {},
) {
  return render(
    <RecordForm
      entity={entity}
      id={null}
      expectedUpdatedAt={null}
      initial={{}}
      options={options}
      cancelHref={`/${entity}`}
      {...extra}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("RecordForm (T-04-02..06)", () => {
  it.each(LIST_ENTITIES)("renders the %s form without accessibility violations", async (entity) => {
    const { container } = renderForm(entity);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await expectNoA11yViolations(container);
  });

  it("creates a contact, then navigates to it", async () => {
    actions.saveContactAction.mockResolvedValue({ ok: true, data: { id: "ct_9" } });
    renderForm("contacts");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/First name/), "Dana");
    await user.click(screen.getByRole("button", { name: "Add phone" }));
    await user.type(screen.getByLabelText("Phone"), "+1 555 0100");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/contacts/ct_9"));
    const input = actions.saveContactAction.mock.calls[0]![0] as {
      id: null;
      values: Record<string, unknown>;
    };
    expect(input.id).toBeNull();
    expect(input.values.firstName).toBe("Dana");
    expect(input.values.phones).toEqual([{ label: "work", number: "+1 555 0100" }]);
    expect(toast.success).toHaveBeenCalledWith("Created.");
  });

  it("shows server field errors inline, keeps input, and focuses the first invalid field", async () => {
    actions.saveContactAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Please check the highlighted fields.",
        requestId: "r",
        fieldErrors: { "values.firstName": ["Enter a first name"] },
      },
    });
    renderForm("contacts");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Last name/), "Rivera");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a first name")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the highlighted fields.");
    expect(screen.getByLabelText(/First name/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/First name/)).toHaveFocus();
    expect(screen.getByLabelText(/Last name/)).toHaveValue("Rivera");
  });

  it("offers a reload on edit conflicts (TC-CON-001)", async () => {
    actions.saveDealAction.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", message: "x", requestId: "r" },
    });
    renderForm("deals", { id: "dl_1", expectedUpdatedAt: "2026-10-10T00:00:00.000Z" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Reload" }));
    expect(router.refresh).toHaveBeenCalled();
    expect(actions.saveDealAction.mock.calls[0]![0]).toMatchObject({
      id: "dl_1",
      expectedUpdatedAt: "2026-10-10T00:00:00.000Z",
    });
  });

  it("warns about duplicates without revealing hidden records (TC-RBAC-004)", async () => {
    renderForm("contacts");
    const user = userEvent.setup();
    const email = screen.getByLabelText(/Email/);

    actions.checkDuplicateAction.mockResolvedValueOnce({
      ok: true,
      data: { status: "visible", id: "ct_1", label: "Dana Rivera" },
    });
    await user.type(email, "dana@acme.test");
    await user.tab();
    expect(await screen.findByRole("link", { name: "Dana Rivera" })).toHaveAttribute(
      "href",
      "/contacts/ct_1",
    );

    actions.checkDuplicateAction.mockResolvedValueOnce({ ok: true, data: { status: "hidden" } });
    await user.click(email);
    await user.tab();
    expect(await screen.findByText(/owned by another user/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dana Rivera" })).not.toBeInTheDocument();

    actions.checkDuplicateAction.mockResolvedValueOnce({ ok: true, data: { status: "none" } });
    await user.click(email);
    await user.tab();
    await waitFor(() =>
      expect(screen.queryByText(/owned by another user/)).not.toBeInTheDocument(),
    );
  });

  it("links tasks to the chosen record type", async () => {
    actions.saveTaskAction.mockResolvedValue({ ok: true, data: { id: "tk_1" } });
    renderForm("tasks");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), "Call back");
    await user.selectOptions(screen.getByLabelText("Related record type"), "deal");
    await user.selectOptions(screen.getByLabelText("Related record"), "dl_1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.saveTaskAction).toHaveBeenCalled());
    expect(actions.saveTaskAction.mock.calls[0]![0]).toMatchObject({
      values: { title: "Call back", related: { type: "deal", id: "dl_1" } },
    });
  });

  it("hides the owner picker from users who can't reassign", () => {
    render(
      <RecordForm
        entity="companies"
        id={null}
        expectedUpdatedAt={null}
        initial={{}}
        options={{ ...options, canReassign: false }}
        cancelHref="/companies"
      />,
    );
    expect(screen.queryByLabelText(/^Owner/)).not.toBeInTheDocument();
  });

  it("removes phones and caps them at three", async () => {
    renderForm("contacts", {
      initial: {
        phones: [
          { label: "work", number: "1" },
          { label: "mobile", number: "2" },
        ],
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add phone" }));
    expect(screen.queryByRole("button", { name: "Add phone" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Remove phone 1/ }));
    expect(screen.getByRole("button", { name: "Add phone" })).toBeInTheDocument();
  });
});
