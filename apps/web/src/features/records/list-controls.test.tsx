import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BarTable } from "../data/bar-table";
import { ExportListButton } from "../data/export-button";
import { OwnerFilter } from "../data/owner-filter";
import { RangeForm } from "../data/range-form";
import { ListToolbar } from "./list-toolbar";
import { TrashRowActions } from "./trash-actions";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const nav = vi.hoisted(() => ({ search: "owner=u_raj&x=1" }));
const actions = vi.hoisted(() => ({
  restoreRecordAction: vi.fn(),
  purgeRecordAction: vi.fn(),
  exportListAction: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/reports",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("./actions", () => actions);
vi.mock("../data/actions", () => actions);
vi.mock("@crm/ui/lib/toast", () => ({ toast }));

const ok = { ok: true as const, data: {} };
const fail = { ok: false as const, error: { code: "FORBIDDEN", message: "x", requestId: "r" } };

beforeEach(() => vi.clearAllMocks());

describe("trash row actions (FR-REC-004)", () => {
  it("restores, and purges after confirmation", async () => {
    actions.restoreRecordAction.mockResolvedValue(ok);
    actions.purgeRecordAction.mockResolvedValue(ok);
    render(<TrashRowActions type="contact" id="ct_1" name="Dana" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Restore Dana" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Restored."));
    await user.click(screen.getByRole("button", { name: "Delete Dana permanently" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Dana permanently?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Deleted permanently."));
    expect(actions.purgeRecordAction).toHaveBeenCalledWith({ type: "contact", id: "ct_1" });
  });

  it("reports refusals", async () => {
    actions.restoreRecordAction.mockResolvedValue(fail);
    render(<TrashRowActions type="contact" id="ct_1" name="Dana" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Restore Dana" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("ListToolbar (FR-SRCH-002)", () => {
  it("applies a sort and one filter through the URL", async () => {
    render(
      <ListToolbar
        entity="contacts"
        sorts={["updated", "name"]}
        filters={[{ id: "tag", options: [{ id: "vip", label: "vip" }] }]}
        current={{ sort: "updated", filter: null, value: null }}
      />,
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Sort by"), "name");
    await user.selectOptions(screen.getByLabelText("Filter"), "tag");
    await user.selectOptions(screen.getByLabelText("Tag"), "vip");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    const url = router.push.mock.calls[0]![0] as string;
    expect(url.startsWith("/contacts?")).toBe(true);
    expect(url).toContain("sort=name");
    expect(url).toContain("filter=tag");
    expect(url).toContain("value=vip");
  });
});

describe("report filters", () => {
  it("RangeForm keeps other params and sets the range", async () => {
    render(<RangeForm from="2026-01-01" to="2026-10-01" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Apply" }));
    expect(router.push).toHaveBeenCalledWith(
      "/reports?owner=u_raj&x=1&from=2026-01-01&to=2026-10-01",
    );
  });

  it("OwnerFilter sets and clears the owner", async () => {
    render(<OwnerFilter members={{ u_raj: "Raj", u_lena: "Lena" }} current="u_raj" />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Owner"), "u_lena");
    expect(router.push).toHaveBeenLastCalledWith("/reports?owner=u_lena&x=1");
    await user.selectOptions(screen.getByLabelText("Owner"), "");
    expect(router.push).toHaveBeenLastCalledWith("/reports?x=1");
  });

  it("BarTable is a real table with decorative bars", () => {
    render(
      <BarTable
        caption="Won deals"
        columns={["Month", "Count"]}
        rows={[
          { key: "a", cells: ["Jan", 2], bar: 2 },
          { key: "b", cells: ["Feb", 4], bar: 4 },
        ]}
      />,
    );
    expect(screen.getByRole("table", { name: "Won deals" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Feb" })).toBeInTheDocument();
  });
});

describe("ExportListButton (FR-IMP-002)", () => {
  it("starts an export of the current view and links to jobs", async () => {
    actions.exportListAction.mockResolvedValueOnce(ok).mockResolvedValueOnce(fail);
    render(<ExportListButton entity="deals" query={{ sort: "updated" }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByRole("link", { name: /Recent imports/ })).toHaveAttribute(
      "href",
      "/settings/import",
    );
    expect(actions.exportListAction).toHaveBeenCalledWith({ entity: "deals", sort: "updated" });
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
