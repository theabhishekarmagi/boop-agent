# Google Workspace connection

Boop uses Composio's native `googlesuper` toolkit, displayed as **Google Workspace**.
One customer-owned connection can run native `GOOGLESUPER_` actions for Gmail,
Calendar, Tasks, Drive, Docs, Sheets and Slides. It does not copy a Gmail token
into other toolkits or share one customer's Google account with another customer.
Existing standalone connections remain usable.

## Operator setup versus customer consent

`requireGoogleWorkspaceAuthConfig()` reads the operator-configured
`COMPOSIO_GOOGLE_WORKSPACE_AUTH_CONFIG_ID` and accepts only an enabled custom
OAuth2 config for `googlesuper`. It rejects API-key, disabled, wrong-toolkit and
Composio-managed configs. The same project auth config serves each customer's
separate connected account. Users only click Connect and approve Google consent.

A live managed OAuth attempt on 2026-10-24 failed with Google's **This app is
blocked**. Composio's Google Super FAQ documents that some cross-product scopes
are not approved on its managed app; the production workaround is a verified
customer-owned Google OAuth app. A managed test config was created, but it is
not used by this implementation after reproducing the provider block. Do not
claim a real Workspace connection works until custom OAuth consent and a real
read-only tool call succeed.

The custom app should request profile/email plus permissions for the seven
Workspace services, excluding Ads, Analytics, Photos and Contacts. The exact
scope list is exported in `server/google-workspace.ts`. Configure the Composio
callback URI shown for that auth config in the Google OAuth web client, enable
the required Workspace APIs, and use Testing mode/test users during qualification.
Public availability requires Google's applicable brand/scope verification and
restricted-data requirements. Google login alone grants no Workspace API access.
Customers can deselect permissions; an ACTIVE connection does not prove every
service was approved. A missing permission requires reconnecting with consent.

Generic integrations without a configured authentication method are shown as
Coming soon. Customers are not sent to developer portals or the Composio dashboard.
To enable one, the operator configures its provider credentials/auth config in the
Composio project. Some providers still require each customer to supply a personal
API key or bot token through the hosted connection flow; UI wording cannot remove
that provider requirement.

The standalone Google Forms toolkit currently has no Composio-managed OAuth.
Google Super exposes supported Forms actions (the live catalog includes
`GOOGLESUPER_GET_FORM`), but this does not guarantee parity with every standalone
Forms action. The UI directs users to Workspace without claiming full Forms support.

## Agent execution

The dispatcher selects a connected `googlesuper` integration for Workspace tasks.
General tasks use its native tool slugs and on-demand discovery. Simple email
priority overviews use the same bounded Gmail workflow and fast-model setting:
one metadata list of at most 20 messages and one optional detail batch of at most
three returned IDs. The adapter maps only the two approved Gmail reads to the
corresponding Google Super tools, pins the current workspace's connection, and
preserves the Gmail namespace inside the bounded agent. Sending, browser work,
workbench discovery and full-thread fetching stay outside this workflow.

## Verification and rollout

Qualification status (2026-10-24): the dedicated `Boop Workspace — Composio`
web client was created in Google project `peshi-512305`, registered as an enabled
custom OAuth2 config in Composio, and its config ID saved in the ignored local
environment. The Google app is External/Testing, with the operator's account
added as a test user and the nine scopes above saved. The operator completed
Google consent; Composio reports the custom connected account ACTIVE.
All seven services passed real read-only calls through a session pinned to
that same account and custom auth config. Tasks initially returned
`SERVICE_DISABLED` (log `log_Oy0QRABdVFGi`); enabling the Tasks API fixed it.

| Service | Native tool verified | Successful Composio log ID |
| --- | --- | --- |
| Gmail | `GOOGLESUPER_GET_PROFILE` | `log_zKp3k3hMqbzZ` |
| Calendar | `GOOGLESUPER_LIST_CALENDARS` | `log_KWVIKJRmF7OM` |
| Tasks | `GOOGLESUPER_LIST_TASK_LISTS` | `log_IjcbbDjXxjpw` |
| Drive | `GOOGLESUPER_LIST_FILES` | `log_0ZCaQuabYFma` |
| Docs | `GOOGLESUPER_GET_DOCUMENT` | `log_EFKDwRVmIJBn` |
| Sheets | `GOOGLESUPER_GET_SPREADSHEET` | `log_RMsycySdK-kq` |
| Slides | `GOOGLESUPER_GET_PRESENTATION` | `log_Dry78zIniCdD` |

Calendar and Tasks lists were limited to one item; Drive queries were bounded
to at most three file IDs/types. Sheets and Slides used metadata-only fields.
No files, messages, tasks or events were created, changed or sent. These checks
prove the integration transport and current account permissions, not every
possible Workspace action or a full conversational agent run.

OAuth client credentials are stored only under ignored `data/google-workspace/`
with private file permissions. The custom auth config ID and updated UI/agent
were deployed to AWS in release `4336f91` on 2026-10-24. Google verification
remains separate from deployment and is still required for public availability.

The live catalog confirmed the unified toolkit and matching email read schemas.
The managed OAuth attempt reproduced the documented Google provider block. Regression coverage is in `tests/google-workspace.test.ts` and the
existing Gmail/catalog/workspace tests. Run `npm test`, `npm run typecheck`, and
`npm run build:debug`.

A configured custom OAuth app and unit tests alone do not prove a real customer
connection; the live calls above supply that proof for the tested account.
The updated UI and agent code now use the custom auth config ID on AWS.
Do not automatically remove
or replace a customer's existing connections during migration.

Sources:
- https://docs.composio.dev/kb/guide/toolkits-googlesuper
- https://docs.composio.dev/toolkits/googlesuper
- https://docs.composio.dev/toolkits/googleforms
- https://docs.composio.dev/docs/authentication/controlling-scopes

- https://docs.composio.dev/toolkits/googlesuper.md
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
