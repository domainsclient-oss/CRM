import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceBranding } from "./workspace-branding";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const actions = vi.hoisted(() => ({
  removeWorkspaceAssetAction: vi.fn(),
  updateWorkspaceBrandingAction: vi.fn(),
  uploadWorkspaceAssetAction: vi.fn(),
}));
const editor = vi.hoisted(() => ({
  props: null as null | Record<string, (...a: unknown[]) => unknown>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => actions);
vi.mock("@crm/ui/components/branding-editor", () => ({
  BrandingEditor: (props: Record<string, (...a: unknown[]) => unknown>) => {
    editor.props = props;
    return null;
  },
}));

describe("WorkspaceBranding", () => {
  it("wires the editor to the workspace branding actions", () => {
    render(
      <WorkspaceBranding
        own={{ appName: null, primaryColor: null, accentColor: null }}
        inherited={{ appName: "A", primaryColor: "#000000", accentColor: "#000000" }}
        assets={{ logoLight: null, logoDark: null, favicon: null }}
        readOnly={false}
      />,
    );
    const file = new File(["x"], "a.png");
    editor.props!.onSave!({ appName: "X" });
    editor.props!.onUpload!("favicon", file);
    editor.props!.onRemove!("favicon");
    editor.props!.onChanged!();
    expect(actions.updateWorkspaceBrandingAction).toHaveBeenCalledWith({ appName: "X" });
    expect(actions.uploadWorkspaceAssetAction).toHaveBeenCalledWith({ kind: "favicon", file });
    expect(actions.removeWorkspaceAssetAction).toHaveBeenCalledWith({ kind: "favicon" });
    expect(router.refresh).toHaveBeenCalled();
  });
});
