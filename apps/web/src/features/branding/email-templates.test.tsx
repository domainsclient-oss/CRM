import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailTemplates } from "./email-templates";

const actions = vi.hoisted(() => ({
  previewEmailAction: vi.fn(),
  saveEmailOverrideAction: vi.fn(),
  sendTestEmailAction: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("./actions", () => actions);
vi.mock("@crm/ui/lib/toast", () => ({ toast }));

const overrides = [
  { template: "workspace_invitation" as const, subject: "Join us", intro: null },
  { template: "password_reset" as const, subject: null, intro: "Reset it" },
];

beforeEach(() => vi.clearAllMocks());

describe("EmailTemplates (FR-BRAND-003)", () => {
  it("saves, previews in a sandboxed frame, and sends a test", async () => {
    actions.saveEmailOverrideAction.mockResolvedValue({ ok: true, data: {} });
    actions.previewEmailAction.mockResolvedValue({
      ok: true,
      data: { subject: "Join Acme", html: "<p>hi</p>" },
    });
    actions.sendTestEmailAction.mockResolvedValue({ ok: true, data: { email: "raj@acme.test" } });
    render(<EmailTemplates overrides={overrides} />);
    const user = userEvent.setup();
    expect(screen.getByLabelText("Subject")).toHaveValue("Join us");
    await user.type(screen.getByLabelText("Intro paragraph"), "Welcome");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(actions.saveEmailOverrideAction).toHaveBeenCalledWith({
        template: "workspace_invitation",
        subject: "Join us",
        intro: "Welcome",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Preview" }));
    const frame = await screen.findByTitle("Email preview");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(screen.getByTestId("email-preview-subject")).toHaveTextContent("Join Acme");

    await user.click(screen.getByRole("button", { name: "Send a test to me" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenLastCalledWith("Test email sent to raj@acme.test."),
    );
  });

  it("switches templates and shows validation errors", async () => {
    actions.saveEmailOverrideAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "x",
        requestId: "r",
        fieldErrors: { subject: ["Unknown variable {{x}}"] },
      },
    });
    render(<EmailTemplates overrides={overrides} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Template"), "password_reset");
    expect(screen.getByLabelText("Intro paragraph")).toHaveValue("Reset it");
    expect(screen.getByLabelText("Subject")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Unknown variable {{x}}")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
  });
});
