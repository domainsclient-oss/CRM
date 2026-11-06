import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../../test/axe";
import { Kanban, type BoardColumnData } from "./kanban";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const actions = vi.hoisted(() => ({ moveDealStageAction: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => actions);
vi.mock("@crm/ui/lib/toast", () => ({ toast }));

const card = (id: string, canMove = true) => ({
  id,
  name: `Deal ${id}`,
  amount: 100,
  owner: "Raj",
  contact: "Dana",
  canMove,
});
const columns: BoardColumnData[] = [
  { stage: { id: "a", name: "New" }, cards: [card("1"), card("2", false)], count: 3, sum: 300 },
  { stage: { id: "b", name: "Won soon" }, cards: [], count: 0, sum: 0 },
];

const column = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-stage="${id}"]`)!;

beforeEach(() => vi.clearAllMocks());

describe("Kanban (FR-DEAL-003)", () => {
  it("renders columns, summaries and the 'more' hint accessibly", async () => {
    const { container } = render(<Kanban columns={columns} currency="USD" locale="en-US" />);
    expect(screen.getByText("No deals in this stage.")).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 of 3/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Move Deal 2 to stage")).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("moves a card with the keyboard-operable select (WCAG 2.5.7)", async () => {
    actions.moveDealStageAction.mockResolvedValue({ ok: true, data: {} });
    const { container } = render(<Kanban columns={columns} currency="USD" locale="en-US" />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Move Deal 1 to stage"), "b");
    expect(within(column(container, "b")).getByText("Deal 1")).toBeInTheDocument();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Moved to Won soon."));
    expect(actions.moveDealStageAction).toHaveBeenCalledWith({ id: "1", stageId: "b" });
  });

  it("rolls back when the server refuses", async () => {
    actions.moveDealStageAction.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "x", requestId: "r" },
    });
    const { container } = render(<Kanban columns={columns} currency="USD" locale="en-US" />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Move Deal 1 to stage"), "b");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(within(column(container, "a")).getByText("Deal 1")).toBeInTheDocument();
  });

  it("moves by drag and drop", async () => {
    actions.moveDealStageAction.mockResolvedValue({ ok: true, data: {} });
    const { container } = render(<Kanban columns={columns} currency="USD" locale="en-US" />);
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? "",
      effectAllowed: "",
    };
    const source = container.querySelector('[data-deal="1"]')!;
    const target = column(container, "b");
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    fireEvent.dragEnd(source);
    await waitFor(() =>
      expect(actions.moveDealStageAction).toHaveBeenCalledWith({ id: "1", stageId: "b" }),
    );
  });
});
