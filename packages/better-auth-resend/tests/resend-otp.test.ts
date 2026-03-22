import { describe, expect, it, vi, beforeEach } from "vitest";
import { resendOTP, resendOTPConfigSchema } from "../src/index.js";

describe("resendOTPConfigSchema", () => {
  it("accepts valid config", () => {
    const result = resendOTPConfigSchema.parse({
      apiKey: "re_test_123",
      fromEmail: "auth@example.com",
      brandName: "My App",
    });
    expect(result.expiryMinutes).toBe(10);
    expect(result.baseUrl).toBe("https://api.resend.com");
  });

  it("rejects missing apiKey", () => {
    expect(() =>
      resendOTPConfigSchema.parse({
        apiKey: "",
        fromEmail: "auth@example.com",
        brandName: "App",
      }),
    ).toThrow();
  });

  it("rejects invalid fromEmail", () => {
    expect(() =>
      resendOTPConfigSchema.parse({
        apiKey: "key",
        fromEmail: "not-email",
        brandName: "App",
      }),
    ).toThrow();
  });

  it("applies default expiryMinutes", () => {
    const result = resendOTPConfigSchema.parse({
      apiKey: "key",
      fromEmail: "a@b.com",
      brandName: "App",
    });
    expect(result.expiryMinutes).toBe(10);
  });
});

describe("resendOTP", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a function", () => {
    const send = resendOTP({
      apiKey: "test",
      fromEmail: "auth@example.com",
      brandName: "Test App",
    });
    expect(typeof send).toBe("function");
  });

  it("sends OTP email via fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "email_123" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const send = resendOTP({
      apiKey: "re_test_key",
      fromEmail: "auth@example.com",
      brandName: "Test App",
      logoUrl: "https://example.com/logo.png",
      websiteUrl: "https://example.com",
    });

    await send("user@example.com", "123456");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body.to).toBe("user@example.com");
    expect(body.from).toBe("auth@example.com");
    expect(body.subject).toContain("123456");
    expect(body.text).toContain("123456");
    expect(body.html).toContain("123456");
  });

  it("includes brand name in subject", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const send = resendOTP({
      apiKey: "key",
      fromEmail: "a@b.com",
      brandName: "Cool App",
    });

    await send("user@test.com", "999999");

    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(body.subject).toContain("Cool App");
  });

  it("throws on API error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });
    vi.stubGlobal("fetch", mockFetch);

    const send = resendOTP({
      apiKey: "bad-key",
      fromEmail: "a@b.com",
      brandName: "App",
    });

    await expect(send("user@test.com", "123456")).rejects.toThrow("Failed to send OTP email");
  });

  it("includes expiry in email body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const send = resendOTP({
      apiKey: "key",
      fromEmail: "a@b.com",
      brandName: "App",
      expiryMinutes: 5,
    });

    await send("user@test.com", "123456");

    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(body.text).toContain("5 minutes");
  });
});
