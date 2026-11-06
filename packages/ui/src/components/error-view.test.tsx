import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test/axe";
import { ErrorView } from "./error-view";

describe("ErrorView", () => {
  it("announces the error and moves focus to the heading", () => {
    render(<ErrorView onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toHaveFocus();
  });

  it("shows the digest as a support reference only when present", () => {
    const { rerender } = render(<ErrorView onRetry={() => {}} />);
    expect(screen.queryByText(/Support reference/)).not.toBeInTheDocument();
    rerender(<ErrorView digest="12345" onRetry={() => {}} />);
    expect(screen.getByText("Support reference: 12345")).toBeInTheDocument();
  });

  it("calls retry", async () => {
    const onRetry = vi.fn();
    render(<ErrorView onRetry={onRetry} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ErrorView digest="1" onRetry={() => {}} />);
    await expectNoA11yViolations(container);
  });
});
