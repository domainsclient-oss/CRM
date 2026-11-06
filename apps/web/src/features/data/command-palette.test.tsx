import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./command-palette";

const actions = vi.hoisted(() => ({ searchAction: vi.fn() }));
vi.mock("./actions", () => actions);

const empty = { contacts: [], companies: [], leads: [], deals: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

async function type(value: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value } });
  await act(() => vi.advanceTimersByTimeAsync(250));
}

describe("CommandPalette (FR-SRCH-001)", () => {
  it("opens with Ctrl+K, debounces, and groups results by entity", async () => {
    actions.searchAction.mockResolvedValue({
      ok: true,
      data: {
        ...empty,
        contacts: [
          { entity: "contacts", id: "ct_1", label: "Dana Rivera", detail: "dana@acme.test" },
        ],
      },
    });
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "Search" });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "d" } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(actions.searchAction).not.toHaveBeenCalled(); // < 2 characters

    await type("dan");
    expect(actions.searchAction).toHaveBeenCalledTimes(1);
    expect(actions.searchAction).toHaveBeenCalledWith({ q: "dan" });
    const group = within(dialog).getByRole("region", { name: "Contacts" });
    expect(within(group).getByRole("link", { name: /Dana Rivera/ })).toHaveAttribute(
      "href",
      "/contacts/ct_1",
    );
    expect(within(group).getByRole("link", { name: "See all contacts" })).toHaveAttribute(
      "href",
      "/contacts",
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 results");
  });

  it("says when nothing matches and hides stale results below 2 characters", async () => {
    actions.searchAction.mockResolvedValue({ ok: true, data: empty });
    render(<CommandPalette />);
    fireEvent.click(screen.getByRole("button", { name: "Search (Ctrl+K)" }));
    await type("zz");
    expect(screen.getByText("No matches.")).toBeInTheDocument();
    await type("z");
    expect(screen.queryByText("No matches.")).not.toBeInTheDocument();
  });

  it("ignores out-of-order responses", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    actions.searchAction
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce({ ok: true, data: empty });
    render(<CommandPalette />);
    fireEvent.click(screen.getByRole("button", { name: "Search (Ctrl+K)" }));
    await type("ab");
    await type("abc");
    await act(async () =>
      resolveFirst({
        ok: true,
        data: { ...empty, deals: [{ entity: "deals", id: "d", label: "Stale", detail: null }] },
      }),
    );
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });
});
