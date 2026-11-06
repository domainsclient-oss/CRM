import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../../test/axe";
import { ActivityComposer, DeleteActivityButton } from "./activity-composer";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const actions = vi.hoisted(() => ({ logActivityAction: vi.fn(), deleteActivityAction: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => actions);
vi.mock("@crm/ui/lib/toast", () => ({ toast }));

const related = { type: "contact" as const, id: "ct_1" };

beforeEach(() => vi.clearAllMocks());

describe("ActivityComposer (FR-ACT-001)", () => {
  it("logs an activity against the record and resets", async () => {
    actions.logActivityAction.mockResolvedValue({ ok: true, data: { id: "ac_1" } });
    const { container } = render(
      <ActivityComposer related={related} today="2026-10-10" now="09:30" />,
    );
    await expectNoA11yViolations(container);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Type"), "call");
    await user.type(screen.getByLabelText("Subject"), "Intro call");
    await user.click(screen.getByRole("button", { name: "Log activity" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Activity logged."));
    expect(actions.logActivityAction.mock.calls[0]![0]).toMatchObject({
      values: {
        type: "call",
        subject: "Intro call",
        occurredDate: "2026-10-10",
        occurredTime: "09:30",
        related: [related],
      },
    });
    expect(screen.getByLabelText("Subject")).toHaveValue("");
  });

  it("maps server errors onto fields", async () => {
    actions.logActivityAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Please check the highlighted fields.",
        requestId: "r",
        fieldErrors: { "values.subject": ["Enter a subject"] },
      },
    });
    render(<ActivityComposer related={related} today="2026-10-10" now="09:30" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Log activity" }));
    expect(await screen.findByText("Enter a subject")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("DeleteActivityButton", () => {
  it("deletes and refreshes, or reports the refusal", async () => {
    actions.deleteActivityAction
      .mockResolvedValueOnce({ ok: true, data: {} })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "FORBIDDEN", message: "x", requestId: "r" },
      });
    render(<DeleteActivityButton id="ac_1" subject="Intro call" />);
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Delete activity: Intro call" });
    await user.click(button);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    await user.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
