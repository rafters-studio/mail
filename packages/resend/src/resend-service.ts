import type {
  AddContactRequest,
  CreateAudienceRequest,
  CreateBroadcastRequest,
  ResendAudience,
  ResendBroadcast,
  ResendBroadcastDetail,
  ResendContact,
  ResendIdResponse,
  SendTransactionalRequest,
  UpdateContactRequest,
} from "./resend-types.js";
import {
  addContactRequestSchema,
  createAudienceRequestSchema,
  createBroadcastRequestSchema,
  resendAudienceSchema,
  resendBroadcastDetailSchema,
  resendBroadcastSchema,
  resendContactSchema,
  resendIdResponseSchema,
  resendListResponseSchema,
  sendTransactionalRequestSchema,
} from "./resend-types.js";

export class ResendError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public resendMessage?: string,
  ) {
    super(message);
    this.name = "ResendError";
  }
}

export interface ResendConfig {
  apiKey: string;
  fromEmail: string;
  baseUrl?: string;
}

export class ResendService {
  private apiKey: string;
  private fromEmail: string;
  private baseUrl: string;

  constructor(config: ResendConfig) {
    this.apiKey = config.apiKey;
    this.fromEmail = config.fromEmail;
    this.baseUrl = config.baseUrl ?? "https://api.resend.com";
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    schema?: (data: unknown) => T,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      throw new ResendError(
        `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
        429,
        "Rate limit exceeded",
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText) as Record<string, unknown>;
        errorMessage = String(errorJson.message ?? errorJson.error ?? errorText);
      } catch {
        // Use raw text
      }
      throw new ResendError(`Resend API error: ${errorMessage}`, response.status, errorMessage);
    }

    // Handle empty responses (204 No Content from DELETE endpoints)
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }

    const data: unknown = await response.json();
    if (schema) {
      return schema(data);
    }
    return data as T;
  }

  // Audiences

  createAudience(request: CreateAudienceRequest): Promise<ResendAudience> {
    const validated = createAudienceRequestSchema.parse(request);
    return this.request(
      "/audiences",
      {
        method: "POST",
        body: JSON.stringify({ name: validated.name }),
      },
      resendAudienceSchema.parse,
    );
  }

  listAudiences(): Promise<{ data: ResendAudience[] }> {
    return this.request("/audiences", {}, resendListResponseSchema(resendAudienceSchema).parse);
  }

  getAudience(audienceId: string): Promise<ResendAudience> {
    return this.request(`/audiences/${audienceId}`, {}, resendAudienceSchema.parse);
  }

  deleteAudience(audienceId: string): Promise<void> {
    return this.request(`/audiences/${audienceId}`, { method: "DELETE" });
  }

  // Contacts

  addContact(audienceId: string, contact: AddContactRequest): Promise<ResendIdResponse> {
    const validated = addContactRequestSchema.parse(contact);
    return this.request(
      "/contacts",
      {
        method: "POST",
        body: JSON.stringify({
          audience_id: audienceId,
          email: validated.email,
          first_name: validated.firstName,
          last_name: validated.lastName,
          unsubscribed: validated.unsubscribed,
        }),
      },
      resendIdResponseSchema.parse,
    );
  }

  listContacts(audienceId: string): Promise<{ data: ResendContact[] }> {
    return this.request(
      `/contacts?audienceId=${audienceId}`,
      {},
      resendListResponseSchema(resendContactSchema).parse,
    );
  }

  getContact(contactId: string): Promise<ResendContact> {
    return this.request(`/contacts/${contactId}`, {}, resendContactSchema.parse);
  }

  updateContact(contactId: string, updates: UpdateContactRequest): Promise<ResendContact> {
    return this.request(
      `/contacts/${contactId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          first_name: updates.firstName,
          last_name: updates.lastName,
          unsubscribed: updates.unsubscribed,
        }),
      },
      resendContactSchema.parse,
    );
  }

  removeContact(contactId: string): Promise<void> {
    return this.request(`/contacts/${contactId}`, { method: "DELETE" });
  }

  // Broadcasts

  createBroadcast(broadcast: CreateBroadcastRequest): Promise<ResendIdResponse> {
    const validated = createBroadcastRequestSchema.parse(broadcast);
    return this.request(
      "/broadcasts",
      {
        method: "POST",
        body: JSON.stringify({
          audience_id: validated.audienceId,
          from: validated.from,
          subject: validated.subject,
          html: validated.html,
          text: validated.text,
          reply_to: validated.replyTo,
          name: validated.name,
        }),
      },
      resendIdResponseSchema.parse,
    );
  }

  getBroadcast(broadcastId: string): Promise<ResendBroadcast> {
    return this.request(`/broadcasts/${broadcastId}`, {}, resendBroadcastSchema.parse);
  }

  getBroadcastDetail(broadcastId: string): Promise<ResendBroadcastDetail> {
    return this.request(`/broadcasts/${broadcastId}`, {}, resendBroadcastDetailSchema.parse);
  }

  sendBroadcast(broadcastId: string): Promise<ResendIdResponse> {
    return this.request(
      `/broadcasts/${broadcastId}/send`,
      {
        method: "POST",
      },
      resendIdResponseSchema.parse,
    );
  }

  // Transactional

  sendTransactional(params: SendTransactionalRequest): Promise<ResendIdResponse> {
    const validated = sendTransactionalRequestSchema.parse(params);
    return this.request(
      "/emails",
      {
        method: "POST",
        body: JSON.stringify({
          from: validated.from ?? this.fromEmail,
          to: validated.to,
          subject: validated.subject,
          text: validated.text,
          html: validated.html,
          reply_to: validated.replyTo,
          attachments: validated.attachments,
        }),
      },
      resendIdResponseSchema.parse,
    );
  }
}
