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
import {
  audienceSchema,
  campaignParamsSchema,
  campaignStatusSchema,
  emailParamsSchema,
  mailingListSchema,
  subscriberSchema,
} from "@rafters/mail";
import type { ResendConfig } from "./resend-service.js";
import { ResendService } from "./resend-service.js";

export function createResendProvider(config: ResendConfig): EmailProvider {
  const resend = new ResendService(config);

  return {
    // Mailing Lists -> Audiences
    async createMailingList(name: string): Promise<MailingList> {
      const audience = await resend.createAudience({ name });
      return mailingListSchema.parse({
        id: audience.id,
        name: audience.name,
        createdAt: new Date(audience.created_at),
      });
    },

    async getMailingList(id: string): Promise<MailingList> {
      const audience = await resend.getAudience(id);
      return mailingListSchema.parse({
        id: audience.id,
        name: audience.name,
        createdAt: new Date(audience.created_at),
      });
    },

    async deleteMailingList(id: string): Promise<void> {
      await resend.deleteAudience(id);
    },

    // Subscribers -> Contacts
    async addSubscriber(listId: string, email: string, data?: SubscriberData): Promise<Subscriber> {
      const contact = await resend.addContact(listId, {
        email,
        firstName: data?.firstName,
        lastName: data?.lastName,
        unsubscribed: data?.unsubscribed,
      });
      const fullContact = await resend.getContact(contact.id);
      return subscriberSchema.parse({
        id: fullContact.id,
        email: fullContact.email,
        firstName: fullContact.first_name,
        lastName: fullContact.last_name,
        unsubscribed: fullContact.unsubscribed,
      });
    },

    async removeSubscriber(_listId: string, subscriberId: string): Promise<void> {
      await resend.removeContact(subscriberId);
    },

    async updateSubscriber(subscriberId: string, updates: SubscriberUpdates): Promise<Subscriber> {
      const contact = await resend.updateContact(subscriberId, {
        firstName: updates.firstName,
        lastName: updates.lastName,
        unsubscribed: updates.unsubscribed,
      });
      return subscriberSchema.parse({
        id: contact.id,
        email: contact.email,
        firstName: contact.first_name,
        lastName: contact.last_name,
        unsubscribed: contact.unsubscribed,
      });
    },

    async listSubscribers(listId: string): Promise<Subscriber[]> {
      const response = await resend.listContacts(listId);
      return response.data.map((contact) =>
        subscriberSchema.parse({
          id: contact.id,
          email: contact.email,
          firstName: contact.first_name,
          lastName: contact.last_name,
          unsubscribed: contact.unsubscribed,
        }),
      );
    },

    // Campaigns -> Broadcasts (one-shot: create + send)
    async sendCampaign(params: CampaignParams): Promise<{ id: string }> {
      const validated = campaignParamsSchema.parse(params);
      const broadcast = await resend.createBroadcast({
        audienceId: validated.listId,
        from: validated.from,
        subject: validated.subject,
        html: validated.html,
        text: validated.text,
        replyTo: validated.replyTo,
        name: validated.name,
      });
      await resend.sendBroadcast(broadcast.id);
      return { id: broadcast.id };
    },

    async getCampaign(id: string): Promise<{ id: string; subject: string; sentAt: Date }> {
      const broadcast = await resend.getBroadcast(id);
      return {
        id: broadcast.id,
        subject: broadcast.subject,
        sentAt: new Date(broadcast.sent_at ?? broadcast.created_at),
      };
    },

    async createCampaignDraft(params: CampaignParams): Promise<{ id: string }> {
      const validated = campaignParamsSchema.parse(params);
      const broadcast = await resend.createBroadcast({
        audienceId: validated.listId,
        from: validated.from,
        subject: validated.subject,
        html: validated.html,
        text: validated.text,
        replyTo: validated.replyTo,
        name: validated.name,
      });
      return { id: broadcast.id };
    },

    async sendCampaignDraft(campaignId: string): Promise<{ id: string }> {
      const result = await resend.sendBroadcast(campaignId);
      return { id: result.id };
    },

    async getCampaignStatus(campaignId: string): Promise<CampaignStatus> {
      const broadcast = await resend.getBroadcastDetail(campaignId);
      return campaignStatusSchema.parse({
        id: broadcast.id,
        status: broadcast.status,
        subject: broadcast.subject,
        sentAt: broadcast.sent_at ? new Date(broadcast.sent_at) : null,
      });
    },

    // Audiences
    async listAudiences(): Promise<Audience[]> {
      const response = await resend.listAudiences();
      return response.data.map((audience) =>
        audienceSchema.parse({
          id: audience.id,
          name: audience.name,
          createdAt: new Date(audience.created_at),
        }),
      );
    },

    // Transactional
    async sendEmail(params: EmailParams): Promise<{ id: string }> {
      const validated = emailParamsSchema.parse(params);
      const result = await resend.sendTransactional({
        to: validated.to,
        subject: validated.subject,
        html: validated.html,
        text: validated.text,
        from: validated.from,
        replyTo: validated.replyTo,
      });
      return { id: result.id };
    },
  };
}
