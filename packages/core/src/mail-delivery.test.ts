import { afterEach, describe, expect, it, vi } from "vitest";
import { createResendProvider, type OutgoingMail } from "./mail-delivery";

const mail: OutgoingMail = {
  from: '"CRM" <no-reply@example.com>',
  to: "requester@example.com",
  subject: "Demo request received",
  html: "<p>Thanks</p>",
  text: "Thanks",
};

afterEach(() => vi.unstubAllGlobals());

describe("Resend mail provider", () => {
  it("sends the rendered message and returns the provider id", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "resend_123" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(createResendProvider("test_api_key").send(mail)).resolves.toEqual({
      id: "resend_123",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mail),
      }),
    );
  });

  it("returns a safe error when Resend rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("private provider details", {
          status: 403,
        }),
      ),
    );

    await expect(createResendProvider("test_api_key").send(mail)).rejects.toMatchObject({
      code: "INTERNAL",
      message: "email_provider_request_failed:resend_status_403",
    });
  });

  it("rejects a malformed success response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

    await expect(createResendProvider("test_api_key").send(mail)).rejects.toMatchObject({
      code: "INTERNAL",
      message: "email_provider_invalid_response:resend",
    });
  });
});
