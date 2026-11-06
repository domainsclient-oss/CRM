import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_EXPIRED_EVENT } from "@crm/shared/auth-messages";
import { OfflineBanner, SessionExpiredDialog, ThemeApplier } from "./status-watchers";

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

afterEach(() => {
  setOnline(true);
  document.documentElement.className = "";
});

describe("status watchers (06 §9)", () => {
  it("shows the offline banner only while offline", () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    act(() => setOnline(false));
    expect(screen.getByRole("alert")).toHaveTextContent(/offline/);
    act(() => setOnline(true));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens the session-expired dialog with a new-tab sign-in link", async () => {
    render(<SessionExpiredDialog />);
    act(() => {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    });
    const link = screen.getByRole("link", { name: "Sign in in a new tab" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link).toHaveAttribute("target", "_blank");
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Close" })[0]!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["dark", false, true],
    ["light", true, false],
    ["system", true, true],
    ["system", false, false],
  ] as const)("applies theme %s (system dark: %s) → dark=%s", (theme, systemDark, dark) => {
    const listeners: Array<() => void> = [];
    vi.stubGlobal("matchMedia", () => ({
      matches: systemDark,
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: vi.fn(),
    }));
    render(<ThemeApplier theme={theme} />);
    expect(document.documentElement.classList.contains("dark")).toBe(dark);
    expect(document.documentElement.style.colorScheme).toBe(dark ? "dark" : "light");
    vi.unstubAllGlobals();
  });
});
