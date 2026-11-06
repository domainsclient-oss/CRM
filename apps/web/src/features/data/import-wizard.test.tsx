import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportWizard } from "./import-wizard";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const actions = vi.hoisted(() => ({ previewImportAction: vi.fn(), startImportAction: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => actions);
vi.mock("@crm/ui/lib/toast", () => ({ toast }));

const preview = {
  header: ["First", "Email"],
  mapping: ["firstName", "email"],
  rowCount: 3,
  errorCount: 1,
  preview: [
    { row: 2, cells: ["Dana", "dana@acme.test"], error: null },
    { row: 3, cells: ["", "bad"], error: "Enter a valid email" },
  ],
};

function mockUpload(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function upload(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText("CSV file"),
    new File(["First,Email\nDana,dana@acme.test"], "people.csv", { type: "text/csv" }),
  );
  await user.click(screen.getByRole("button", { name: "Upload and preview" }));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("ImportWizard (FR-IMP-001)", () => {
  it("uploads with the CSRF header, previews, remaps and starts the job", async () => {
    const fetchMock = mockUpload({ ok: true, data: { uploadId: "up_1" } });
    actions.previewImportAction.mockResolvedValue({ ok: true, data: preview });
    actions.startImportAction.mockResolvedValue({ ok: true, data: { jobId: "job_1" } });
    render(<ImportWizard />);
    const user = userEvent.setup();
    await upload(user);

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/imports");
    expect(init.headers).toMatchObject({ "X-CRM-Request": "1" });
    expect(await screen.findByText("Enter a valid email")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 rows have problems");

    await user.selectOptions(screen.getByLabelText("Field for column “First”"), "");
    expect(actions.previewImportAction).toHaveBeenLastCalledWith({
      uploadId: "up_1",
      entity: "contacts",
      mapping: [null, "email"],
    });

    await user.click(screen.getByLabelText("Update the existing record"));
    await user.click(screen.getByRole("button", { name: "Import 2 rows" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(actions.startImportAction).toHaveBeenCalledWith({
      uploadId: "up_1",
      entity: "contacts",
      mapping: ["firstName", "email"],
      duplicateMode: "update",
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows upload errors from the route handler", async () => {
    mockUpload({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "x",
        requestId: "r",
        fieldErrors: { file: ["The file is larger than 10 MB"] },
      },
    });
    render(<ImportWizard />);
    await upload(userEvent.setup());
    expect(await screen.findByRole("alert")).toHaveTextContent("larger than 10 MB");
    expect(actions.previewImportAction).not.toHaveBeenCalled();
  });

  it("explains plan limits when starting the import", async () => {
    mockUpload({ ok: true, data: { uploadId: "up_1" } });
    actions.previewImportAction.mockResolvedValue({ ok: true, data: preview });
    actions.startImportAction.mockResolvedValue({
      ok: false,
      error: { code: "PLAN_LIMIT_EXCEEDED", message: "x", requestId: "r" },
    });
    render(<ImportWizard />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Import into"), "companies");
    await upload(user);
    await user.click(await screen.findByRole("button", { name: "Import 2 rows" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(actions.previewImportAction.mock.calls[0]![0]).toMatchObject({ entity: "companies" });
  });
});
