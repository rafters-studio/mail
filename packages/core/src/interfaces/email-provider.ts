import { z } from "zod";

// Domain types (platform vocabulary, not vendor vocabulary)

export const mailingListSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.date(),
});
export type MailingList = z.infer<typeof mailingListSchema>;

export const subscriberSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  unsubscribed: z.boolean(),
});
export type Subscriber = z.infer<typeof subscriberSchema>;

export const subscriberDataSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  unsubscribed: z.boolean().optional(),
});
export type SubscriberData = z.infer<typeof subscriberDataSchema>;

export const subscriberUpdatesSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  unsubscribed: z.boolean().optional(),
});
export type SubscriberUpdates = z.infer<typeof subscriberUpdatesSchema>;

export const campaignParamsSchema = z.object({
  listId: z.string(),
  subject: z.string().min(1).max(200),
  html: z.string().min(1),
  text: z.string().optional(),
  from: z.string().email(),
  replyTo: z.string().email().optional(),
  name: z.string().optional(),
});
export type CampaignParams = z.infer<typeof campaignParamsSchema>;

export const campaignStatusSchema = z.object({
  id: z.string(),
  status: z.enum(["draft", "queued", "sending", "sent", "cancelled"]),
  subject: z.string(),
  sentAt: z.date().nullable(),
});
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const audienceSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.date(),
});
export type Audience = z.infer<typeof audienceSchema>;

export const emailParamsSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  html: z.string().optional(),
  text: z.string().optional(),
  from: z.string().email().optional(),
  replyTo: z.string().email().optional(),
});
export type EmailParams = z.infer<typeof emailParamsSchema>;

export interface EmailProvider {
  // Transactional
  sendEmail(params: EmailParams): Promise<{ id: string }>;

  // Mailing lists
  createMailingList(name: string): Promise<MailingList>;
  getMailingList(id: string): Promise<MailingList>;
  deleteMailingList(id: string): Promise<void>;

  // Subscribers
  addSubscriber(listId: string, email: string, data?: SubscriberData): Promise<Subscriber>;
  removeSubscriber(listId: string, subscriberId: string): Promise<void>;
  updateSubscriber(subscriberId: string, updates: SubscriberUpdates): Promise<Subscriber>;
  listSubscribers(listId: string): Promise<Subscriber[]>;

  // Campaigns
  sendCampaign(params: CampaignParams): Promise<{ id: string }>;
  getCampaign(id: string): Promise<{ id: string; subject: string; sentAt: Date }>;
  createCampaignDraft(params: CampaignParams): Promise<{ id: string }>;
  sendCampaignDraft(campaignId: string): Promise<{ id: string }>;
  getCampaignStatus(campaignId: string): Promise<CampaignStatus>;

  // Audiences
  listAudiences(): Promise<Audience[]>;
}
