# Bounded Gmail priority overview

Simple priority/unread inbox overviews use the `gmail_priority` execution workflow selected by the chat dispatcher. The workflow is saved with the agent record so retries retain its limits. Other email tasks (exhaustive audits, custom date searches, sending/drafting, etc.) keep the general integration workflow.

The overview exposes only `priority_inbox` and `priority_email_details`. It has no Composio tool discovery, remote workbench, browser, local shell or draft tools. Integration setup skips loading the generic meta-tool session for this workflow. All reads use a Composio session pinned to a Gmail account belonging to the current workspace.

- One metadata-only Gmail list call, capped at 20 messages, cached for this task.
- Defaults to seven recent days, unread/important/starred inbox mail, excluding promotions/social. The tool accepts a 1–30 day window.
- Optional single batch of up to three individual full-message reads, performed concurrently. IDs must come from that task's list. Repeated identical requests return cached data; extra requests or cross-account IDs are refused.
- Multiple connected Gmail accounts require explicit account selection; the service never silently chooses one.
- Compact outputs omit full MIME, attachments and unnecessary fields. Coverage reports the query, window, sample count and whether another page exists. A sample is never described as a full mailbox audit.
- Summarization uses the installation's configured `BOOP_SMALL_MODEL`. General execution continues using the user's selected runtime model.
- Email text is untrusted data. The summary should group duplicate notifications and check later approvals/resolutions before treating an old failure as an unresolved issue.

The shared `read_tool_result` helper now describes its query as a literal substring. If a model supplies a nonmatching question, it returns a normal result page with guidance instead of an empty dead end.

On a single-worker server, startup reconciliation fails abandoned running/queued records before accepting new work. It does not replay interrupted tasks. Startup waits briefly for a cold development database instead of admitting work without successful reconciliation. Multiple workers sharing one database require worker leases before using this startup policy.

## Verification

Run `npm test`, `npm run test:workspaces`, and `npm run typecheck`.

`npm run smoke:gmail-priority -- --model=gpt-5.6-luna` exercises a real model against synthetic mail only. It checks actionable deadlines, an empty inbox, an old failure superseded by approval, and instructions embedded in an email. It requires existing model credentials and consumes model usage, but reads no actual mailbox and sends no messages. Reports are saved under ignored `data/gmail-priority/`.

Local observed live mailbox tests (one run each, not a controlled performance benchmark):

| Overview worker | Wall time | Gmail tool invocations | Model requests | Input tokens |
| --- | ---: | ---: | ---: | ---: |
| gpt-5.6-sol | 38.7s | one list + one detail batch | 3 | 12,084 |
| gpt-5.6-luna | 20.7s | one list | 2 | 4,709 |

Both read 18 matching messages over a 14-day window. The model chose different amounts of detail, so the timing/token difference cannot be attributed to model size alone. Dispatcher overhead is additional. The earlier inefficient task's trace reached 65 seconds without a final answer, so it is not a completed baseline for a speedup percentage.

Four synthetic live-model cases passed in 6.7–8.0 seconds each. Deterministic regression tests also verify account isolation, detail budgets, read-only tool surfaces, malformed provider output, literal-result recovery and startup interruption handling. These checks do not guarantee latency or model interpretation on every mailbox.

A separate full chat-dispatch-to-completion test passed in 36.2 seconds: 20.1 seconds for the dispatcher to acknowledge/admit the task, followed by background completion. It selected `gmail_priority` automatically, used only `priority_inbox`, reviewed a capped 20-message sample and reported more matching messages. This includes dispatcher overhead and is the more representative user-facing measurement; it is not the same run as the 20.7-second direct-worker test.
