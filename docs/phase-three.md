# Individual safety API

Run the API and web client from the repository root with Node 24. The HTTP tests use a fresh, uniquely named local MongoDB database for each run. They do not load the Atlas URI from the API environment file.

```bash
nvm use
npm ci
npm run build
npm run lint --workspace client
node api/tests/phase-two.mjs
node api/tests/phase-three.mjs
npm run dev
```

## Accounts and consent

Register, log in, refresh, log out, update your display name and recover your password through the existing `/api/auth` routes. Use the main domain for individual accounts. Send the login response's access token as a Bearer token for protected endpoints.

| Individual endpoint | Action |
| --- | --- |
| GET /api/individual/account | Read the account, username and verified contacts |
| PUT /api/individual/username | Claim a unique username using a JSON object with a username field |
| POST /api/individual/verification/request | Send a code to the account email or an E.164 phone number using channel and, for SMS, phone |
| POST /api/individual/verification/confirm | Submit channel and code before the ten-minute expiry |
| GET, PUT, DELETE /api/individual/safety-profile | Read, replace or clear the voluntary profile and all disclosure grants |

Email and SMS verification need a delivery service configured with VERIFICATION_DELIVERY_URL and VERIFICATION_DELIVERY_TOKEN. The API sends an HTTPS POST with bearer authentication and JSON containing channel (email or phone), target and code. The service must deliver the code privately and return a success status. The tests simulate this service. Password recovery uses the existing SMTP settings.

A profile contains an information object and a disclosure array. Each disclosure entry grants a named tenant permission to receive a report under an explicit-consent routing rule. Its fields array lists the profile fields that tenant may read while handling an active, eligible incident. An empty list permits referral without granting any profile fields. Replacing or deleting the profile changes subsequent disclosure reads. Use fictional values for testing.

## Report intake

1. POST /api/individual/safety-identity as the individual. Save the returned personal report URL and six private codes. Generating a new identity replaces all old codes. DELETE on the same path revokes them.
2. Open the returned URL relative to the web app. Opening the page does not send a report. Enter the code for the intended level and deliberately submit the form. The optional country accepts a two-letter uppercase code.
3. An API client can POST selector and secret to /api/auth/safety/validate to inspect the credential level. POST those fields plus a UUID requestId and optional category and country to /api/auth/safety/report to submit. Reuse the requestId when retrying the same submission.
4. For a signed-in report, POST level and requestId plus optional category and country to /api/individual/status. GET the same path for current status or append /history for the latest 100 events.

Levels 0–5 represent unknown, confirmed safe, assistance needed, safety concern, serious danger and critical danger. Levels 2–5 create incidents of low, moderate, high and critical severity respectively. The highest unresolved incident determines current status while emergencies are active.

## Institutional response

Configure at least one active, verified, available organization with matching country, category, capability, nationality and severity criteria. Empty nationality criteria accept any nationality. Lower numerical priority wins. Equal priorities across organizations are ordered by tenant ID. Configure the member's permissions in the platform organization settings. Previously saved custom role definitions retain their configured permissions.

| Endpoint | Authorization and behavior |
| --- | --- |
| GET /api/incidents | Tenant administration or incidents.manage sees the organization queue. incidents.respond sees only assigned cases. Paginate with page starting at 1. |
| GET /api/incidents/{handle} | Read permitted report fields, current version and this tenant's timeline |
| GET /api/incidents/{handle}/disclosure | Read consented profile fields for an active eligible case |
| POST /api/incidents/{handle}/actions | Send the current version and a command. A stale version returns 409. |
| GET /api/platform/incidents/pending | Super Admin on the main domain lists pending references, including emergencies from before M12 |
| POST /api/platform/incidents/{reference}/retry | Reevaluate a pending report against current policy |

Commands include assign with officer (a tenant user ID), acknowledge, note with note text, refer with tenant and note, and resolve with note. Assignment and referral require management permission. Resolution requires acknowledgement. Referral issues a new handle and restricts access to the receiving organization. Unmatched reports stay pending until eligible routing is configured and retried. The queues support participating organizations handling incidents within SARIEL.
