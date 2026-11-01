# Reads one message from stdin with Python's email package (email.policy.default)
# and prints it as the ReadBack JSON of src/index.ts.
import email
import json
import re
import sys
from email import policy

msg = email.message_from_bytes(sys.stdin.buffer.read(), policy=policy.default)


def ids(value):
    return re.findall(r"<([^>]+)>", str(value)) if value is not None else []


def mailbox(a):
    return {"name": a.display_name, "address": a.addr_spec}


def addresses(field):
    header = msg[field]
    if header is None:
        return []
    out = []
    for g in header.groups:
        if g.display_name is None:
            out += [mailbox(a) for a in g.addresses]
        else:
            out.append({"group": g.display_name, "members": [mailbox(a) for a in g.addresses]})
    return out


def content(part):
    return part.get_content().replace("\r\n", "\n") if part is not None else None


types = [p.get_content_type() for p in msg.walk()]
message_id = ids(msg["Message-ID"])
print(json.dumps({
    "messageId": message_id[0] if message_id else None,
    "subject": str(msg["Subject"]) if msg["Subject"] is not None else None,
    "from": addresses("From"),
    "to": addresses("To"),
    "cc": addresses("Cc"),
    "textBeforeHtml": "text/plain" in types and "text/html" in types
    and types.index("text/plain") < types.index("text/html"),
    "text": content(msg.get_body(("plain",))),
    "html": content(msg.get_body(("html",))),
    "attachments": [
        {"filename": a.get_filename(), "size": len(a.get_payload(decode=True))}
        for a in msg.iter_attachments()
        if a.get_content_type() != "message/rfc822"
    ],
    "inReplyTo": ids(msg["In-Reply-To"]),
    "references": ids(msg["References"]),
}))
