# A real client (form 01a19de8, Tests): Python's smtplib against a local server hosting the session.
# Each scenario on stdin is one connection; what smtplib said goes to stdout as one JSON line.
import json
import smtplib
import sys

port = int(sys.argv[1])
results = []
for scenario in json.load(sys.stdin):
    client = smtplib.SMTP()
    client.connect("127.0.0.1", port)
    client.ehlo("client.example")
    if scenario["mechanism"] == "LOGIN":
        client.esmtp_features["auth"] = "LOGIN"
    client.login("user", "password")
    refused = client.sendmail(
        scenario["from"], scenario["to"], scenario["message"].encode("latin-1")
    )
    client.quit()
    results.append(refused)
print(json.dumps(results))
