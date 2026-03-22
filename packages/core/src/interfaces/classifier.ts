import { z } from "zod";
import { aiCategorySchema, threadPrioritySchema } from "../schema/enums.js";

export const emailClassificationSchema = z.object({
  category: aiCategorySchema,
  confidence: z.number().min(0).max(100),
  tags: z.array(z.string()),
  priority: threadPrioritySchema,
});
export type EmailClassification = z.infer<typeof emailClassificationSchema>;

export interface EmailClassifier {
  classify(from: string, subject: string, body: string): Promise<EmailClassification>;
}

export function isLegitimateCategory(category: string): boolean {
  return category !== "spam";
}
