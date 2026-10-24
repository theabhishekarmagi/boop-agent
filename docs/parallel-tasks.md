# Parallel chat tasks

Chat dispatch no longer waits for an execution agent's final answer. `spawn_agent` admits a background task and returns its ID plus running/queued status. The dispatcher promptly finishes the chat turn, freeing the channel intake to handle the next message. Background task results are saved in the conversation and delivered separately with the task name.

Each account can run three background chat tasks simultaneously and hold up to twenty running/queued tasks. Extra independent tasks queue for capacity. Accounts have separate capacity, task lists, dependencies, cancellation and result delivery. Direct automation/retry paths retain their existing execution behavior.

For dependent work, the dispatcher uses `list_active_tasks` to find task IDs in the current conversation, then sets `depends_on` when spawning. The scheduler waits for every prerequisite and provides completed results to the new execution agent. Waiting dependencies do not consume execution slots or block unrelated tasks. A failed or cancelled prerequisite fails its dependents without running them. IDs from other accounts/conversations and unknown/self references are rejected. Dependencies can only reference already-admitted jobs, preventing cycles.

Examples:

- “Review my unread emails.” Then “Research hotels in Hyderabad.” Both run independently.
- While hotel research runs: “After the hotel research finishes, compare those options by price.” The comparison waits for that research, not unrelated email work.

Dependency interpretation is model-guided: sharing a topic alone is not a dependency, and ambiguous references should trigger clarification. The scheduler enforces whatever explicit dependency IDs the dispatcher chooses; it cannot guarantee perfect natural-language interpretation.

The Agents page displays waiting tasks as Queued. Dependency IDs appear in their logs. Cancellation works before and during execution. Existing draft approval rules are unchanged.

This is a single-server scheduler. Conversation messages, task records, results and logs persist in Convex, but the in-memory execution/dependency graph does not resume after a process restart. Orphaned queued/running records are failed by the heartbeat after its stale threshold; tasks are not replayed automatically because they may already have performed work. Recent completed results are retained in memory for explicit dependencies (up to 100 retained tasks per account; very large prerequisite results use marked excerpts). A delivery failure leaves the saved result available in the dashboard, but this change does not add a durable outbound notification queue. Multi-replica deployment needs durable task orchestration before scaling workers.

Regression tests prove overlap before either task completes, real prerequisite result handoff, independent-task progress, per-account capacity, failure propagation, cancellation, isolation, bounded admission and completion notification failure handling. These tests use deterministic synthetic tasks rather than sending user messages or executing external actions.
