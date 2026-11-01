// The part of mailparser 3.9.39's simpleParser that readBack reads; the package ships no types.
declare module "mailparser" {
  type EmailAddress = { name: string; address?: string; group?: EmailAddress[] };
  type AddressObject = { value: EmailAddress[] };
  type ParsedMail = {
    messageId?: string;
    subject?: string;
    from?: AddressObject;
    to?: AddressObject;
    cc?: AddressObject;
    text?: string;
    html: string | false;
    attachments: { filename?: string; size: number; contentType: string }[];
    inReplyTo?: string;
    references?: string | string[];
  };
  export function simpleParser(source: Buffer): Promise<ParsedMail>;
}
