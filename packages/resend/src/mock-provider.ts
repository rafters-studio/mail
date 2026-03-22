import type {
  Audience,
  CampaignParams,
  CampaignStatus,
  EmailParams,
  EmailProvider,
  MailingList,
  Subscriber,
  SubscriberData,
  SubscriberUpdates,
} from "@rafters/mail";
import { uuidv7 } from "uuidv7";

interface StoredCampaign {
  id: string;
  subject: string;
  sentAt: Date | null;
  status: CampaignStatus["status"];
}

interface SentEmail {
  id: string;
  params: EmailParams;
  sentAt: Date;
}

export function createMockEmailProvider(): EmailProvider & {
  sentEmails: SentEmail[];
  clear(): void;
  getState(): {
    lists: MailingList[];
    subscribers: Subscriber[];
    campaigns: StoredCampaign[];
    sentEmails: SentEmail[];
  };
} {
  const lists = new Map<string, MailingList>();
  const subscribers = new Map<string, Subscriber>();
  const campaigns = new Map<string, StoredCampaign>();
  const sentEmails: SentEmail[] = [];

  return {
    sentEmails,

    // Mailing Lists
    async createMailingList(name: string): Promise<MailingList> {
      const list: MailingList = { id: uuidv7(), name, createdAt: new Date() };
      lists.set(list.id, list);
      return list;
    },

    async getMailingList(id: string): Promise<MailingList> {
      const list = lists.get(id);
      if (!list) throw new Error(`Mailing list not found: ${id}`);
      return list;
    },

    async deleteMailingList(id: string): Promise<void> {
      lists.delete(id);
    },

    // Subscribers
    async addSubscriber(
      _listId: string,
      email: string,
      data?: SubscriberData,
    ): Promise<Subscriber> {
      const subscriber: Subscriber = {
        id: uuidv7(),
        email,
        firstName: data?.firstName,
        lastName: data?.lastName,
        unsubscribed: data?.unsubscribed ?? false,
      };
      subscribers.set(subscriber.id, subscriber);
      return subscriber;
    },

    async removeSubscriber(_listId: string, subscriberId: string): Promise<void> {
      subscribers.delete(subscriberId);
    },

    async updateSubscriber(subscriberId: string, updates: SubscriberUpdates): Promise<Subscriber> {
      const subscriber = subscribers.get(subscriberId);
      if (!subscriber) throw new Error(`Subscriber not found: ${subscriberId}`);
      if (updates.firstName !== undefined) subscriber.firstName = updates.firstName;
      if (updates.lastName !== undefined) subscriber.lastName = updates.lastName;
      if (updates.unsubscribed !== undefined) subscriber.unsubscribed = updates.unsubscribed;
      subscribers.set(subscriberId, subscriber);
      return subscriber;
    },

    async listSubscribers(_listId: string): Promise<Subscriber[]> {
      return Array.from(subscribers.values());
    },

    // Campaigns
    async sendCampaign(params: CampaignParams): Promise<{ id: string }> {
      const id = uuidv7();
      campaigns.set(id, { id, subject: params.subject, sentAt: new Date(), status: "sent" });
      return { id };
    },

    async getCampaign(id: string): Promise<{ id: string; subject: string; sentAt: Date }> {
      const campaign = campaigns.get(id);
      if (!campaign) throw new Error(`Campaign not found: ${id}`);
      return { id: campaign.id, subject: campaign.subject, sentAt: campaign.sentAt ?? new Date() };
    },

    async createCampaignDraft(params: CampaignParams): Promise<{ id: string }> {
      const id = uuidv7();
      campaigns.set(id, { id, subject: params.subject, sentAt: null, status: "draft" });
      return { id };
    },

    async sendCampaignDraft(campaignId: string): Promise<{ id: string }> {
      const campaign = campaigns.get(campaignId);
      if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);
      campaign.status = "sent";
      campaign.sentAt = new Date();
      return { id: campaignId };
    },

    async getCampaignStatus(campaignId: string): Promise<CampaignStatus> {
      const campaign = campaigns.get(campaignId);
      if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);
      return {
        id: campaign.id,
        status: campaign.status,
        subject: campaign.subject,
        sentAt: campaign.sentAt,
      };
    },

    // Audiences
    async listAudiences(): Promise<Audience[]> {
      return Array.from(lists.values()).map((list) => ({
        id: list.id,
        name: list.name,
        createdAt: list.createdAt,
      }));
    },

    // Transactional
    async sendEmail(params: EmailParams): Promise<{ id: string }> {
      const id = uuidv7();
      sentEmails.push({ id, params, sentAt: new Date() });
      return { id };
    },

    // Test helpers
    clear(): void {
      lists.clear();
      subscribers.clear();
      campaigns.clear();
      sentEmails.length = 0;
    },

    getState() {
      return {
        lists: Array.from(lists.values()),
        subscribers: Array.from(subscribers.values()),
        campaigns: Array.from(campaigns.values()),
        sentEmails: [...sentEmails],
      };
    },
  };
}
