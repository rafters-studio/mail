import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  broadcastAudit,
  platformAudience,
  platformSubscriber,
} from "../../src/schema/newsletter.js";

describe("newsletter table definitions", () => {
  it("defines all 3 tables with correct names", () => {
    expect(getTableName(platformAudience)).toBe("platform_audience");
    expect(getTableName(platformSubscriber)).toBe("platform_subscriber");
    expect(getTableName(broadcastAudit)).toBe("broadcast_audit");
  });

  it("platformAudience has required columns", () => {
    const columns = Object.keys(platformAudience);
    expect(columns).toContain("id");
    expect(columns).toContain("providerListId");
    expect(columns).toContain("name");
    expect(columns).toContain("slug");
    expect(columns).toContain("createdAt");
    expect(columns).toContain("deletedAt");
  });

  it("platformSubscriber has required columns", () => {
    const columns = Object.keys(platformSubscriber);
    expect(columns).toContain("id");
    expect(columns).toContain("userId");
    expect(columns).toContain("audienceId");
    expect(columns).toContain("providerSubscriberId");
    expect(columns).toContain("subscribedAt");
    expect(columns).toContain("deletedAt");
  });

  it("broadcastAudit has required columns", () => {
    const columns = Object.keys(broadcastAudit);
    expect(columns).toContain("id");
    expect(columns).toContain("providerCampaignId");
    expect(columns).toContain("subject");
    expect(columns).toContain("sentBy");
    expect(columns).toContain("audienceName");
    expect(columns).toContain("recipientCount");
    expect(columns).toContain("sentAt");
    expect(columns).toContain("deletedAt");
  });

  it("user references are plain text without FK", () => {
    expect(platformSubscriber.userId.columnType).toBe("SQLiteText");
    expect(broadcastAudit.sentBy.columnType).toBe("SQLiteText");
  });

  it("all tables have soft delete", () => {
    for (const table of [platformAudience, platformSubscriber, broadcastAudit]) {
      expect(Object.keys(table)).toContain("deletedAt");
    }
  });
});
