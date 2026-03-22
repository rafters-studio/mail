import { describe, expect, it, vi } from "vitest";
import { createResendWebhookHandler, resendWebhookEventSchema } from "../src/webhook-handler.js";

const makeEvent = (type: string, data: Record<string, unknown> = {}) => ({
  type,
  created_at: "2026-03-21T00:00:00.000Z",
  data: { email_id: "email_123", ...data },
});

describe("resendWebhookEventSchema", () => {
  it("accepts valid delivered event", () => {
    const result = resendWebhookEventSchema.parse(makeEvent("email.delivered"));
    expect(result.type).toBe("email.delivered");
    expect(result.data.email_id).toBe("email_123");
  });

  it("accepts bounce with type and message", () => {
    const result = resendWebhookEventSchema.parse(
      makeEvent("email.bounced", {
        bounce: { type: "hard", message: "Mailbox not found" },
      }),
    );
    expect(result.data.bounce?.type).toBe("hard");
  });

  it("accepts complaint event", () => {
    const result = resendWebhookEventSchema.parse(
      makeEvent("email.complained", {
        complaint: { feedback_type: "abuse" },
      }),
    );
    expect(result.data.complaint?.feedback_type).toBe("abuse");
  });

  it("rejects unknown event type", () => {
    expect(() => resendWebhookEventSchema.parse(makeEvent("email.unknown"))).toThrow();
  });
});

describe("createResendWebhookHandler", () => {
  it("calls onDelivered for delivered events", async () => {
    const onDelivered = vi.fn();
    const handler = createResendWebhookHandler({ onDelivered });

    const result = await handler(makeEvent("email.delivered"));

    expect(onDelivered).toHaveBeenCalledWith(
      "email_123",
      expect.objectContaining({ type: "email.delivered" }),
    );
    expect(result).toEqual({ handled: true, type: "email.delivered" });
  });

  it("calls onBounced with bounce details", async () => {
    const onBounced = vi.fn();
    const handler = createResendWebhookHandler({ onBounced });

    await handler(
      makeEvent("email.bounced", {
        bounce: { type: "hard", message: "User unknown" },
      }),
    );

    expect(onBounced).toHaveBeenCalledWith(
      "email_123",
      "hard",
      "User unknown",
      expect.objectContaining({ type: "email.bounced" }),
    );
  });

  it("calls onComplained for complaint events", async () => {
    const onComplained = vi.fn();
    const handler = createResendWebhookHandler({ onComplained });

    await handler(makeEvent("email.complained"));

    expect(onComplained).toHaveBeenCalledWith(
      "email_123",
      expect.objectContaining({ type: "email.complained" }),
    );
  });

  it("handles events with no matching callback", async () => {
    const handler = createResendWebhookHandler({});

    const result = await handler(makeEvent("email.sent"));

    expect(result).toEqual({ handled: true, type: "email.sent" });
  });

  it("calls onOpened for open events", async () => {
    const onOpened = vi.fn();
    const handler = createResendWebhookHandler({ onOpened });

    await handler(makeEvent("email.opened"));

    expect(onOpened).toHaveBeenCalledOnce();
  });

  it("calls onClicked for click events", async () => {
    const onClicked = vi.fn();
    const handler = createResendWebhookHandler({ onClicked });

    await handler(makeEvent("email.clicked"));

    expect(onClicked).toHaveBeenCalledOnce();
  });

  it("defaults bounce type to unknown when missing", async () => {
    const onBounced = vi.fn();
    const handler = createResendWebhookHandler({ onBounced });

    await handler(makeEvent("email.bounced", { bounce: { message: "Rejected" } }));

    expect(onBounced).toHaveBeenCalledWith("email_123", "unknown", "Rejected", expect.anything());
  });

  it("rejects invalid payload", async () => {
    const handler = createResendWebhookHandler({});

    await expect(handler({ bad: "data" })).rejects.toThrow();
  });
});
