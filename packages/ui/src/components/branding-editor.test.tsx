import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test/axe";
import { BrandingEditor } from "./branding-editor";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@crm/ui/lib/toast", () => ({ toast }));

const inherited = { appName: "Agency CRM", primaryColor: "#1F6FEB", accentColor: "#0F766E" };
const ok = { ok: true as const, data: {} };
const fail = (fieldErrors?: Record<string, string[]>) => ({
  ok: false as const,
  error: { code: "VALIDATION" as const, message: "x", requestId: "r", fieldErrors },
});

function setup(overrides: Partial<Parameters<typeof BrandingEditor>[0]> = {}) {
  const props = {
    own: { appName: null, primaryColor: null, accentColor: null },
    inherited,
    assets: { logoLight: "/api/brand/x.png", logoDark: null, favicon: null },
    onSave: vi.fn(async () => ok),
    onUpload: vi.fn(async () => ok),
    onRemove: vi.fn(async () => ok),
    onChanged: vi.fn(),
    ...overrides,
  };
  const view = render(<BrandingEditor {...props} />);
  return { props, view, user: userEvent.setup() };
}

beforeEach(() => vi.clearAllMocks());

describe("BrandingEditor (FR-BRAND-001/002)", () => {
  it("inherits blank values, saves overrides and previews both modes", async () => {
    const { props, view, user } = setup();
    await expectNoA11yViolations(view.container);
    expect(screen.getAllByText("Agency CRM").length).toBeGreaterThanOrEqual(2); // previews
    await user.type(screen.getByLabelText("App name"), "  Acme CRM ");
    await user.type(screen.getByLabelText("Primary colour"), "#7C3AED");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith({
        appName: "Acme CRM",
        primaryColor: "#7C3AED",
        accentColor: null,
      }),
    );
    expect(props.onChanged).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it("blocks saving colours that can't meet contrast and suggests one", async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText("Primary colour"), "#7F7F7F");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /contrast requirements. Try #[0-9A-F]{6}/,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows field and form errors from the server", async () => {
    const onSave = vi
      .fn()
      .mockResolvedValueOnce(fail({ appName: ["Too long"] }))
      .mockResolvedValueOnce(fail());
    const { user } = setup({ onSave });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Too long")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/highlighted fields/);
  });

  it("uploads, reports upload errors, and removes assets", async () => {
    const onUpload = vi
      .fn()
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(fail({ file: ["Use a PNG under 512 KB"] }));
    const onRemove = vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(fail());
    const { props, user } = setup({ onUpload, onRemove });
    const png = new File(["x"], "logo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Logo (dark backgrounds)"), png);
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith("logoDark", png));
    await user.upload(screen.getByLabelText("Favicon"), png);
    expect(await screen.findByText("Use a PNG under 512 KB")).toBeInTheDocument();

    expect(
      screen.getByRole("img", { name: "Current Logo (light backgrounds)" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Logo (light backgrounds)" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("logoLight"));
    expect(props.onChanged).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove Logo (light backgrounds)" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("is read-only without edit rights", () => {
    setup({ readOnly: true });
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("App name")).toBeDisabled();
    expect(screen.getByLabelText("Favicon")).toBeDisabled();
  });
});
