import { describe, expect, it, beforeEach } from "vitest";
import { createMockEmailProvider } from "../src/mock-provider.js";

describe("createMockEmailProvider", () => {
  const mock = createMockEmailProvider();

  beforeEach(() => {
    mock.clear();
  });

  describe("mailing lists", () => {
    it("creates and retrieves a mailing list", async () => {
      const list = await mock.createMailingList("Newsletter");
      expect(list.name).toBe("Newsletter");
      expect(list.id).toBeTruthy();

      const retrieved = await mock.getMailingList(list.id);
      expect(retrieved.name).toBe("Newsletter");
    });

    it("deletes a mailing list", async () => {
      const list = await mock.createMailingList("Temp");
      await mock.deleteMailingList(list.id);
      await expect(mock.getMailingList(list.id)).rejects.toThrow();
    });

    it("lists audiences", async () => {
      await mock.createMailingList("List A");
      await mock.createMailingList("List B");
      const audiences = await mock.listAudiences();
      expect(audiences).toHaveLength(2);
    });
  });

  describe("subscribers", () => {
    it("adds a subscriber", async () => {
      const sub = await mock.addSubscriber("list-1", "user@example.com", {
        firstName: "Sean",
      });
      expect(sub.email).toBe("user@example.com");
      expect(sub.firstName).toBe("Sean");
      expect(sub.unsubscribed).toBe(false);
    });

    it("updates a subscriber", async () => {
      const sub = await mock.addSubscriber("list-1", "user@example.com");
      const updated = await mock.updateSubscriber(sub.id, { unsubscribed: true });
      expect(updated.unsubscribed).toBe(true);
    });

    it("removes a subscriber", async () => {
      const sub = await mock.addSubscriber("list-1", "user@example.com");
      await mock.removeSubscriber("list-1", sub.id);
      const all = await mock.listSubscribers("list-1");
      expect(all).toHaveLength(0);
    });
  });

  describe("campaigns", () => {
    it("sends a campaign", async () => {
      const result = await mock.sendCampaign({
        listId: "list-1",
        subject: "Weekly Update",
        html: "<p>Content</p>",
        from: "news@example.com",
      });
      expect(result.id).toBeTruthy();

      const campaign = await mock.getCampaign(result.id);
      expect(campaign.subject).toBe("Weekly Update");
    });

    it("supports two-step draft flow", async () => {
      const draft = await mock.createCampaignDraft({
        listId: "list-1",
        subject: "Draft",
        html: "<p>Draft</p>",
        from: "news@example.com",
      });

      const status = await mock.getCampaignStatus(draft.id);
      expect(status.status).toBe("draft");
      expect(status.sentAt).toBeNull();

      await mock.sendCampaignDraft(draft.id);

      const sent = await mock.getCampaignStatus(draft.id);
      expect(sent.status).toBe("sent");
      expect(sent.sentAt).toBeInstanceOf(Date);
    });
  });

  describe("transactional email", () => {
    it("records sent emails", async () => {
      await mock.sendEmail({ to: "user@example.com", subject: "OTP" });
      expect(mock.sentEmails).toHaveLength(1);
      expect(mock.sentEmails[0].params.to).toBe("user@example.com");
    });
  });

  describe("state management", () => {
    it("clear resets all state", async () => {
      await mock.createMailingList("List");
      await mock.addSubscriber("list-1", "a@b.com");
      await mock.sendEmail({ to: "a@b.com", subject: "Hi" });
      mock.clear();

      const state = mock.getState();
      expect(state.lists).toHaveLength(0);
      expect(state.subscribers).toHaveLength(0);
      expect(state.sentEmails).toHaveLength(0);
    });

    it("getState returns all stored data", async () => {
      await mock.createMailingList("List");
      await mock.sendEmail({ to: "a@b.com", subject: "Hi" });
      const state = mock.getState();
      expect(state.lists).toHaveLength(1);
      expect(state.sentEmails).toHaveLength(1);
    });
  });
});
