// The part of mailparser 3.9.39's simpleParser that readBack reads; the package ships no types
// (form 01a18fda, Tests): "It reads with postal-mime 4.0.7, mailparser 3.9.39 and
// `python_read.py`, run as `python3 -I python_read.py` (Python 3.9 or later) with the message on
// stdin, parsing with `email.policy.default`."
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
