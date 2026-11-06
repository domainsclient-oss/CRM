import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../../test/axe";
import { PipelineEditor, ProfileForm, WorkspaceSettingsForm } from "./settings-forms";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const actions = vi.hoisted(() => ({
  updatePipelineAction: vi.fn(),
  updateProfileAction: vi.fn(),
  updateTenantSettingsAction: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/records/actions", () => actions);
vi.mock("@crm/ui/lib/toast", () => ({ toast }));

const values = {
  timezone: "UTC",
  locale: "en-US",
  currency: "USD",
  dateFormat: "YYYY-MM-DD",
  weekStart: "monday",
  fiscalYearStartMonth: 1,
};
const zones = ["UTC", "Asia/Kolkata"];

beforeEach(() => vi.clearAllMocks());

describe("WorkspaceSettingsForm (FR-SET-001)", () => {
  it("submits every setting and refreshes", async () => {
    actions.updateTenantSettingsAction.mockResolvedValue({ ok: true, data: {} });
    const { container } = render(
      <WorkspaceSettingsForm values={values} timeZones={zones} readOnly={false} />,
    );
    await expectNoA11yViolations(container);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Time zone"), "Asia/Kolkata");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(actions.updateTenantSettingsAction.mock.calls[0]![0]).toMatchObject({
      timezone: "Asia/Kolkata",
      currency: "USD",
      fiscalYearStartMonth: "1",
    });
    expect(toast.success).toHaveBeenCalledWith("Settings saved.");
  });

  it("shows field errors from the server", async () => {
    actions.updateTenantSettingsAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "x",
        requestId: "r",
        fieldErrors: { timezone: ["Unknown time zone"] },
      },
    });
    render(<WorkspaceSettingsForm values={values} timeZones={zones} readOnly={false} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Unknown time zone")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("is read-only for members without settings access", () => {
    render(<WorkspaceSettingsForm values={values} timeZones={zones} readOnly />);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Time zone")).toBeDisabled();
  });
});

describe("ProfileForm (FR-SET-002)", () => {
  it("saves the display name, time zone and theme", async () => {
    actions.updateProfileAction.mockResolvedValue({ ok: true, data: {} });
    render(
      <ProfileForm
        values={{ displayName: "Raj", timezone: null, theme: "system", email: "raj@acme.test" }}
        timeZones={zones}
      />,
    );
    const user = userEvent.setup();
    const name = screen.getByLabelText("Display name");
    await user.clear(name);
    await user.type(name, "Raj K");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(actions.updateProfileAction).toHaveBeenCalledWith({
        displayName: "Raj K",
        timezone: "",
        theme: "system",
      }),
    );
  });
});

describe("PipelineEditor (FR-DEAL-002)", () => {
  const stages = [
    { id: "stg_a", name: "New", probability: 10 },
    { id: "stg_b", name: "Proposal", probability: 50 },
    { id: "stg_c", name: "Negotiation", probability: 80 },
  ];

  it("reorders, renames, adds stages and maps deals from removed ones", async () => {
    actions.updatePipelineAction.mockResolvedValue({ ok: true, data: {} });
    render(<PipelineEditor stages={stages} readOnly={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Move stage 2 up" }));
    await user.click(screen.getByRole("button", { name: "Move stage 1 down" }));
    await user.click(screen.getByRole("button", { name: "Remove stage 3" }));
    await user.selectOptions(screen.getByLabelText("Move deals from “Negotiation” to"), "stg_b");
    await user.click(screen.getByRole("button", { name: "Add stage" }));
    await user.type(screen.getByLabelText("Stage 3 name"), "Won soon");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.updatePipelineAction).toHaveBeenCalled());
    expect(actions.updatePipelineAction.mock.calls[0]![0]).toEqual({
      stages: [
        { id: "stg_a", name: "New", probability: 10 },
        { id: "stg_b", name: "Proposal", probability: 50 },
        { id: "", name: "Won soon", probability: 50 },
      ],
      moves: { stg_c: "stg_b" },
    });
  });

  it("hides editing controls when read-only", () => {
    render(<PipelineEditor stages={stages} readOnly />);
    expect(screen.queryByRole("button", { name: "Add stage" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Stage 1 name")).toBeDisabled();
  });
});
