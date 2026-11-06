import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "./notification-bell";

const actions = vi.hoisted(() => ({
  markReadAction: vi.fn(),
  notificationsAction: vi.fn(),
  unreadCountAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("./actions", () => actions);

const item = (id: string, readAt: string | null = null) => ({
  id,
  type: "record_assigned",
  title: `Deal ${id}`,
  link: `/deals/${id}`,
  readAt,
  createdAt: "2026-10-10T00:00:00.000Z",
});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

beforeEach(() => {
  vi.clearAllMocks();
  setVisibility("visible");
  actions.unreadCountAction.mockResolvedValue({ ok: true, data: { unread: 2 } });
  actions.markReadAction.mockResolvedValue({ ok: true, data: {} });
});
afterEach(() => vi.useRealTimers());

describe("NotificationBell (FR-NOTF-001)", () => {
  it("lists notifications, marks one and then all as read, and pages older ones", async () => {
    actions.notificationsAction
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [item("1"), item("2", "x")], nextCursor: "c1", unread: 1 },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [item("3")], nextCursor: null, unread: 2 },
      });
    render(<NotificationBell initialUnread={1} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(await screen.findByRole("link", { name: /Deal 1/ })).toHaveAttribute("href", "/deals/1");

    await user.click(screen.getByRole("button", { name: "Mark Deal 1 as read" }));
    expect(actions.markReadAction).toHaveBeenCalledWith({ id: "1" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Mark Deal 1 as read" })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Older notifications" }));
    expect(await screen.findByRole("link", { name: /Deal 3/ })).toBeInTheDocument();
    expect(actions.notificationsAction).toHaveBeenLastCalledWith({ cursor: "c1" });

    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(actions.markReadAction).toHaveBeenLastCalledWith({ id: "all" });
  });

  it("shows the empty state", async () => {
    actions.notificationsAction.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: null, unread: 0 },
    });
    render(<NotificationBell initialUnread={0} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  });

  it("polls every minute only while the tab is visible (T-08-06)", async () => {
    vi.useFakeTimers();
    render(<NotificationBell initialUnread={0} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(actions.unreadCountAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Notifications (2 unread)" })).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(actions.unreadCountAction).toHaveBeenCalledTimes(2);

    setVisibility("hidden");
    await act(() => vi.advanceTimersByTimeAsync(180_000));
    expect(actions.unreadCountAction).toHaveBeenCalledTimes(2);

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.unreadCountAction).toHaveBeenCalledTimes(3);
  });
});
