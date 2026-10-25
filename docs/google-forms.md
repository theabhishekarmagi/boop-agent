# Google Forms respondent workflow

Google Forms/Google Workspace APIs expose form management and response reads,
not a respondent submission endpoint. Boop uses a separate Browser Use worker for
public respondent forms rather than inventing a Composio submission tool.

## User flow

1. Send a public `docs.google.com/forms/.../viewform` or `forms.gle` link and ask
   Boop to prepare answers. No Google app connection is needed for a public form.
2. Boop inspects the questions and saves a workspace/conversation-owned draft
   with the exact proposed answers. The task has no submission tool.
3. Reply **submit it** after reviewing the draft. The interaction agent passes
   the actual human message into the decision tool; page text cannot authorize it.
4. The backend atomically claims the draft, reopens the form in a fresh profile,
   checks that questions/options match, fills fields, reads answers back, and
   clicks Submit once. Success requires a Google response confirmation page.

A changed form, invalid answer, or unsupported field stops before submission.
Expired drafts must be prepared again. A claimed draft cannot be reset or
resubmitted, including after a crash. An unverified result is `uncertain`, never
reported as success or automatically retried. Check with the form owner before
creating another draft if the result is uncertain. There is no exactly-once
transaction across Google and Convex; preventing automatic retries favors avoiding
duplicates over automatic recovery.

## Supported scope

Public, single-page forms, up to 60 questions: short text, paragraph, radio,
checkbox and dropdown fields. Standard choices on questions with an Other box
are supported; custom Other responses are excluded. Forms requiring sign-in,
CAPTCHA interaction, uploads, grids, date/time inputs or multiple pages stop with
an explanation. A custom confirmation message with no recognizable confirmation
link may be reported as uncertain. Google markup changes can require maintenance.

## Local configuration

Run `npm run setup:browser` for the pinned Browser Use Python runtime. Set
`BOOP_FORMS_ENABLED=true` in `.env.local`, deploy the draft mutations to the
intended Convex development deployment, and restart the server. The browser is
launched only when a form tool is used. This path does not call another LLM.

`npm run test:forms` exercises a real browser against synthetic local forms,
including nested checkbox options, a radio Other box, stale fingerprints,
unsupported multi-page navigation and an unverified result. It never submits a
response to an external form. The report is `data/google-forms/qualification.json`.
`npm test` and `npm run test:workspaces` cover policy and durable ownership/state.
`npm run smoke:forms -- <public-form-url>` runs the live configured model through
inspection and draft preparation in an isolated test workspace. It cannot submit
and marks its test draft rejected afterward. The report is
`data/google-forms/live-preparation.json`.

Qualification on the supplied Event registration form read all six questions and
saved a draft through the real model, tools and development backend in about
20 seconds. The real form was not filled or submitted. The synthetic browser
qualification verified one submission per request and honest uncertain outcomes.

## AWS worker configuration

Include all active overlays in every future Compose command:

```sh
docker compose -f deploy/aws/compose.yaml \
  -f deploy/aws/compose.public-test.yaml \
  -f deploy/aws/compose.forms.yaml up -d --build agent browser browser-proxy
```

Generate at least 32 random characters on the host. Store the same value as
`BOOP_FORM_BROWSER_TOKEN` in `deploy/aws/agent.env` and the separate
`deploy/aws/form-browser.env` (mode 600, ignored by Git). The latter must contain
only that token. Never put app secrets in the browser service environment.

The worker has no public port, app source, application credentials, runtime data
volume or existing browser profile. Each operation starts a fresh profile.
The worker accepts only inspect/submit requests, with one browser at a time and
bounded request size, runtime, memory and process count. Requests do not supply
JavaScript, executables, profiles or proxy configuration. It is attached only to
an internal Docker network. An egress proxy allows selected Google hosts over
HTTPS and denies private, link-local and metadata destinations. Google Forms
content is treated as untrusted data throughout the agent prompt.

The Docker Chromium configuration disables Chromium's own OS sandbox because
of container runtime constraints. Isolation here is the dedicated non-root,
read-only container, dropped capabilities, no-new-privileges, separate network,
Google-only egress and lack of app credentials. Do not broaden this worker into
a general-purpose public browser. Size the host for the additional 1.5 GiB browser
limit before enabling it; measure actual RAM under load. The deployment overlay
has to be validated on the target Docker host before activation.

On the existing 4 GB Lightsail test host, a 4 GB swap file provides headroom
alongside the resident embedding model. This uses existing disk, not another
AWS service; monitor memory and latency before increasing browser concurrency.
Chromium starts without a default window so Browser Use creates an allowed blank
target, avoiding a distro new-tab/navigation-watchdog startup race.


## Live submission qualification (2026-10-25)

A signed-in local Boop conversation invoked the normal dispatcher, execution
agent, draft tools and browser worker against the supplied Event registration
test form. The form owner explicitly approved the required test acknowledgement.
The owner’s Responses view showed one response matching all six approved sample
answers. The first three attempts stopped before submission on strict field
verification; only the final attempt clicked Submit. Its initial automatic status
was uncertain after navigation; the owner’s recorded response confirmed receipt.

The live run exposed two Browser Use action issues: keyboard typing could leave
an input blank, and a coordinate click could fail to retain a lower checkbox
selection. Text fields now use native value setters with input/change events;
choice controls read back their state after clicking, with one exact-control
activation if the coordinate click did not retain the intended state. Final
whole-form verification still runs before the one submission click. Synthetic
regressions simulate discarded keyboard input and an unretained coordinate click.

Confirmation polling reacquires the current page and tolerates transient
navigation/context errors (including a click error after navigation) without
clicking Submit again. The actual form is never resubmitted just to test this
confirmation repair. A saved uncertain draft remains non-retryable; external
verification is recorded in its conversation rather than silently resetting it.
