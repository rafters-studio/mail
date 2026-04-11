# Classification

Automatic categorization of incoming email using AI or rule-based classifiers.

---

## The classification adapter

```typescript
interface ClassificationAdapter {
  classify(message: ClassificationInput): Promise<ClassificationResult>;
}

interface ClassificationInput {
  subject: string;
  from: string;
  textBody: string;
  htmlBody?: string;
}

interface ClassificationResult {
  category: AiCategory;
  confidence: number; // 0-100
  summary: string; // one-line description
}
```

The adapter is called after a message is stored. Classification results are written to the message record.

---

## Categories

| Category    | When to use                                                    |
| ----------- | -------------------------------------------------------------- |
| support     | Customer asking for help, bug reports, how-to questions        |
| feedback    | Product feedback, feature requests, suggestions                |
| billing     | Payment issues, invoice questions, subscription changes        |
| partnership | Business proposals, integration requests, collaboration offers |
| abuse       | Harassment, threats, terms of service violations               |
| legal       | Legal notices, compliance requests, DMCA takedowns             |
| spam        | Unsolicited commercial email, phishing attempts                |
| other       | Everything else                                                |

---

## How classification is used

### Folder assignment

Classification can drive automatic folder assignment. A message classified as `spam` with confidence > 80 moves to the spam folder. A message classified as `support` stays in the inbox.

### Priority

High-confidence `billing` or `legal` classifications can automatically set thread priority to `high` or `urgent`.

### Dashboard filtering

The ctrl dashboard filters by category. "Show me all unresolved support threads" is a query on `aiCategory = 'support'` AND `status = 'open'`.

---

## Confidence scores

The confidence score (0-100) indicates how certain the classifier is about its category assignment.

| Range  | Meaning           | Action                             |
| ------ | ----------------- | ---------------------------------- |
| 80-100 | High confidence   | Auto-assign folder, set priority   |
| 50-79  | Medium confidence | Suggest category, let user confirm |
| 0-49   | Low confidence    | No automatic action                |

Thresholds are configurable per mailbox. A high-volume support inbox might auto-assign at 70. A personal inbox might require 90.

---

## Spam detection

Spam classification is separate from the general category classifier. The message record has dedicated fields:

| Field     | Purpose      |
| --------- | ------------ |
| isSpam    | boolean flag |
| spamScore | 0-100 score  |

Spam detection can combine multiple signals: the AI classifier's spam category, header analysis (SPF/DKIM failures), content patterns, and sender reputation. The `isSpam` flag is the final decision after combining all signals.

---

## Implementing a classifier

The simplest classifier uses zero-shot classification with a language model:

```typescript
const classifier: ClassificationAdapter = {
  async classify(input) {
    const result = await model.run({
      text: `${input.subject}\n\n${input.textBody}`,
      labels: ["support", "feedback", "billing", "partnership", "abuse", "legal", "spam", "other"],
    });

    return {
      category: result.label as AiCategory,
      confidence: Math.round(result.score * 100),
      summary: await model.summarize(input.textBody, { maxLength: 100 }),
    };
  },
};
```

You can also implement rule-based classification (regex patterns on subject/sender), or a hybrid that uses rules first and falls back to AI for uncertain cases.
