import { z } from 'zod';

export const inboundEmailSchema = z.object({
  raw: z.instanceof(ArrayBuffer),
  from: z.string().email(),
  to: z.string().email(),
  headers: z.record(z.string(), z.string()),
});
export type InboundEmail = z.infer<typeof inboundEmailSchema>;

export interface InboundAdapter {
  handleIncoming(email: InboundEmail): Promise<{ messageId: string; threadId: string }>;
}
