import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileNav, NavList, RouteFocus, type NavLink } from "./app-nav";

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const links: NavLink[] = [
  ["/", "Dashboard"],
  ["/contacts", "Contacts"],
  ["/contacts?filter=lifecycle&value=customer", "Customers"],
  ["/deals", "Deals"],
];

afterEach(() => {
  nav.pathname = "/";
  nav.search = "";
  vi.useRealTimers();
});

const current = () =>
  screen
    .getAllByRole("link")
    .filter((a) => a.getAttribute("aria-current") === "page")
    .map((a) => a.textContent);

describe("navigation (06 §5.1)", () => {
  it.each([
    ["/", "", ["Dashboard"]],
    ["/contacts/ct_1", "", ["Contacts"]],
    ["/contacts", "filter=lifecycle&value=customer", ["Customers"]],
    ["/deals", "", ["Deals"]],
  ])("marks %s?%s as current", (pathname, search, expected) => {
    nav.pathname = pathname;
    nav.search = search;
    render(<NavList links={links} />);
    expect(current()).toEqual(expected);
  });

  it("opens the mobile drawer and closes it on navigation", async () => {
    const { rerender } = render(<MobileNav links={links} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    nav.pathname = "/deals";
    rerender(<MobileNav links={links} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus to the page heading after client navigation, not on first load", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<main><h1>Deals</h1></main>";
    const heading = document.querySelector("h1")!;
    const { rerender } = render(<RouteFocus />);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(heading).not.toHaveFocus();
    nav.pathname = "/deals";
    rerender(<RouteFocus />);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute("tabindex", "-1");
  });
});
