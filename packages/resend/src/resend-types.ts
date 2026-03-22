import { z } from "zod";

// Resend API response schemas (match Resend's exact format)

export const resendAudienceSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
});
export type ResendAudience = z.infer<typeof resendAudienceSchema>;

export const resendContactSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  created_at: z.string(),
  unsubscribed: z.boolean(),
});
export type ResendContact = z.infer<typeof resendContactSchema>;

export const broadcastStatusSchema = z.enum(["draft", "queued", "sending", "sent", "cancelled"]);

export const resendBroadcastSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  audience_id: z.string(),
  from: z.string(),
  subject: z.string(),
  reply_to: z.union([z.string(), z.array(z.string())]).optional(),
  preview_text: z.string().optional(),
  created_at: z.string(),
  scheduled_at: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
});
export type ResendBroadcast = z.infer<typeof resendBroadcastSchema>;

export const resendBroadcastDetailSchema = resendBroadcastSchema.extend({
  status: broadcastStatusSchema,
});
export type ResendBroadcastDetail = z.infer<typeof resendBroadcastDetailSchema>;

export const resendIdResponseSchema = z.object({
  id: z.string(),
});
export type ResendIdResponse = z.infer<typeof resendIdResponseSchema>;

export const resendListResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
  });

// Resend API request schemas

export const createAudienceRequestSchema = z.object({
  name: z.string().min(1, "Audience name is required"),
});
export type CreateAudienceRequest = z.infer<typeof createAudienceRequestSchema>;

export const addContactRequestSchema = z.object({
  email: z.string().email("Invalid email address"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  unsubscribed: z.boolean().optional(),
});
export type AddContactRequest = z.infer<typeof addContactRequestSchema>;

export const updateContactRequestSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  unsubscribed: z.boolean().optional(),
});
export type UpdateContactRequest = z.infer<typeof updateContactRequestSchema>;

export const createBroadcastRequestSchema = z.object({
  audienceId: z.string().min(1, "Audience ID is required"),
  from: z.string().min(1, "From is required"),
  subject: z.string().min(1, "Subject is required").max(200, "Subject too long"),
  html: z.string().optional(),
  text: z.string().optional(),
  replyTo: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  name: z.string().optional(),
});
export type CreateBroadcastRequest = z.infer<typeof createBroadcastRequestSchema>;

export const emailAttachmentSchema = z.object({
  filename: z.string(),
  content: z.string(),
  contentType: z.string().optional(),
});
export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;

export const sendTransactionalRequestSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string().min(1, "Subject is required"),
  html: z.string().optional(),
  text: z.string().optional(),
  replyTo: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  from: z.string().optional(),
  attachments: z.array(emailAttachmentSchema).optional(),
});
export type SendTransactionalRequest = z.infer<typeof sendTransactionalRequestSchema>;
