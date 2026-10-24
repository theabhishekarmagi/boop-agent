# AI connection recovery

Every Boop agent uses the shared runtime's Agents SDK retry policy. The runner retries only the interrupted model request, keeping the run's history and completed local tool results. It does not restart the task or replay completed tools. Transport-level SDK retries stay disabled so there is one retry budget.

- At most three retries per model request (four attempts total).
- Exponential backoff with jitter, starting at 500ms and capped at 4 seconds between attempts.
- Retries transient network failures, HTTP 408, temporary HTTP 429 rate limits, and HTTP 5xx responses.
- Respects provider Retry-After up to 30 seconds; longer delays end the task rather than ignoring the requested wait.
- Authentication, permission, invalid-request and exhausted billing/quota errors are not retried. Provider retry vetoes are respected.
- Cancellation stops requests and backoff immediately.
- The SDK refuses automatic replay after streaming starts or when provider replay safety forbids it. An interrupted response may include operations already performed remotely; restarting an entire task would be unsafe.

If recovery is exhausted or unsafe, task history and user replies explain that the AI connection was interrupted and advise reviewing completed steps before retrying. Existing logs retain the underlying error for diagnosis. Retry warnings contain only attempt number and HTTP status, without prompts, tool results, or credentials.

This mitigates transient failures; it cannot guarantee completion during a prolonged outage, lost connectivity, or process crash. It does not add durable task resumption after a server restart. Retried requests may consume additional model usage, including usage a provider did not report before disconnecting.

Regression tests run the real HTTP provider and Agents SDK against synthetic responses: successful recovery after a tool, exact preservation of continuation inputs, one tool execution, exhaustion, cancellation, permanent errors, provider delay/veto, and interrupted streams. No live email or paid model call is used for those tests.
