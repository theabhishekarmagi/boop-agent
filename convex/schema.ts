import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  userProfiles: defineTable({
    ownerId: v.string(), clerkUserId: v.string(), phone: v.string(), createdAt: v.number(),
    whatsappJid: v.optional(v.string()), botAccount: v.optional(v.string()),
    codeHash: v.optional(v.string()), codeExpiresAt: v.optional(v.number()), lastCodeAt: v.optional(v.number()),
    minuteBucket: v.optional(v.number()), minuteTurns: v.optional(v.number()),
    dayBucket: v.optional(v.number()), dayTurns: v.optional(v.number()),
  }).index("by_ownerId", ["ownerId"]).index("by_phone", ["phone"])
    .index("by_codeHash", ["codeHash"]).index("by_whatsappJid", ["whatsappJid"]),
  messages: defineTable({
    ownerId: v.optional(v.string()),
    conversationId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    agentId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_ownerId", ["ownerId"])
    .index("by_conversation", ["conversationId"])
    .index("owner_by_conversation", ["ownerId", "conversationId"])
    .index("by_conversation_turn", ["conversationId", "turnId"])
    .index("owner_by_conversation_turn", ["ownerId", "conversationId", "turnId"]),

  conversations: defineTable({
    ownerId: v.optional(v.string()),
    conversationId: v.string(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    messageCount: v.number(),
    lastActivityAt: v.number(),
  }).index("by_ownerId", ["ownerId"])
    .index("by_conversation", ["conversationId"])
    .index("owner_by_conversation", ["ownerId", "conversationId"]),

  memoryRecords: defineTable({
    ownerId: v.optional(v.string()),
    ownerLifecycle: v.optional(v.string()),
    memoryId: v.string(),
    content: v.string(),
    tier: v.union(v.literal("short"), v.literal("long"), v.literal("permanent")),
    segment: v.union(
      v.literal("identity"),
      v.literal("preference"),
      v.literal("correction"),
      v.literal("relationship"),
      v.literal("project"),
      v.literal("knowledge"),
      v.literal("context"),
    ),
    importance: v.number(),
    decayRate: v.number(),
    accessCount: v.number(),
    lastAccessedAt: v.number(),
    sourceTurn: v.optional(v.string()),
    lifecycle: v.union(v.literal("active"), v.literal("archived"), v.literal("pruned")),
    supersedes: v.optional(v.array(v.string())),
    embedding: v.optional(v.array(v.float64())),
    // Structured sidecar data (JSON blob). Currently used to carry
    // `corrects` text on correction-segment memories. Intentionally loose
    // so extraction prompts can stash provider-specific hints without
    // schema churn.
    metadata: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_ownerId", ["ownerId"])
    .index("by_memory_id", ["memoryId"])
    .index("owner_by_memory_id", ["ownerId", "memoryId"])
    .index("by_tier", ["tier"])
    .index("owner_by_tier", ["ownerId", "tier"])
    .index("by_segment", ["segment"])
    .index("owner_by_segment", ["ownerId", "segment"])
    .index("by_lifecycle", ["lifecycle"])
    .index("owner_by_lifecycle", ["ownerId", "lifecycle"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["ownerLifecycle", "lifecycle"],
    }),

  executionAgents: defineTable({
    ownerId: v.optional(v.string()),
    agentId: v.string(),
    conversationId: v.optional(v.string()),
    name: v.string(),
    task: v.string(),
    status: v.union(
      v.literal("spawned"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("paused"),
    ),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    mcpServers: v.array(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.optional(v.number()),
    cacheCreationTokens: v.optional(v.number()),
    costUsd: v.number(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_ownerId", ["ownerId"])
    .index("by_agent_id", ["agentId"])
    .index("owner_by_agent_id", ["ownerId", "agentId"])
    .index("by_status", ["status"])
    .index("owner_by_status", ["ownerId", "status"])
    .index("by_conversation", ["conversationId"])
    .index("owner_by_conversation", ["ownerId", "conversationId"]),

  // Append-only LLM usage log. Every model call (dispatcher, execution,
  // extract, consolidation) writes a row here so you can query total cost
  // by source, conversation, or time range.
  usageRecords: defineTable({
    ownerId: v.optional(v.string()),
    source: v.union(
      v.literal("dispatcher"),
      v.literal("execution"),
      v.literal("extract"),
      v.literal("consolidation-proposer"),
      v.literal("consolidation-adversary"),
      v.literal("consolidation-judge"),
      v.literal("proactive"),
    ),
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    agentId: v.optional(v.string()),
    runId: v.optional(v.string()),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheCreationTokens: v.number(),
    costUsd: v.number(),
    durationMs: v.number(),
    createdAt: v.number(),
  }).index("by_ownerId", ["ownerId"])
    .index("by_conversation", ["conversationId"])
    .index("owner_by_conversation", ["ownerId", "conversationId"])
    .index("by_agent", ["agentId"])
    .index("owner_by_agent", ["ownerId", "agentId"])
    .index("by_source", ["source"])
    .index("owner_by_source", ["ownerId", "source"]),

  agentLogs: defineTable({
    ownerId: v.optional(v.string()),
    agentId: v.string(),
    logType: v.union(
      v.literal("thinking"),
      v.literal("tool_use"),
      v.literal("tool_result"),
      v.literal("text"),
      v.literal("error"),
    ),
    toolName: v.optional(v.string()),
    // Composio account aliases targeted by this tool call (e.g. ["gmail_charry-fusc"]).
    // Populated when the input names a specific connected account, so multi-account
    // toolkits make it visible which inbox / workspace was actually hit.
    accounts: v.optional(v.array(v.string())),
    content: v.string(),
    createdAt: v.number(),
  }).index("by_ownerId", ["ownerId"])
    .index("by_agent", ["agentId"])
    .index("owner_by_agent", ["ownerId", "agentId"]),

  memoryEvents: defineTable({
    ownerId: v.optional(v.string()),
    eventType: v.string(),
    conversationId: v.optional(v.string()),
    memoryId: v.optional(v.string()),
    agentId: v.optional(v.string()),
    data: v.string(),
    createdAt: v.number(),
  }).index("by_ownerId", ["ownerId"])
    .index("by_conversation", ["conversationId"])
    .index("owner_by_conversation", ["ownerId", "conversationId"])
    .index("by_type", ["eventType"])
    .index("owner_by_type", ["ownerId", "eventType"]),

  automations: defineTable({
    ownerId: v.optional(v.string()),
    automationId: v.string(),
    name: v.string(),
    task: v.string(),
    integrations: v.array(v.string()),
    schedule: v.string(),
    // IANA timezone the cron expression is evaluated in. Stored at create
    // time so changing the user's global timezone later doesn't shift
    // existing automations. Optional for backwards compatibility — pre-TZ
    // automations fall back to the user's current setting at run time.
    timezone: v.optional(v.string()),
    enabled: v.boolean(),
    conversationId: v.optional(v.string()),
    notifyConversationId: v.optional(v.string()),
    lastRunAt: v.optional(v.number()),
    nextRunAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_ownerId", ["ownerId"])
    .index("by_automation_id", ["automationId"])
    .index("owner_by_automation_id", ["ownerId", "automationId"])
    .index("by_enabled", ["enabled"])
    .index("owner_by_enabled", ["ownerId", "enabled"]),

  sendblueDedup: defineTable({
    ownerId: v.optional(v.string()),
    handle: v.string(),
    claimedAt: v.number(),
  }).index("by_ownerId", ["ownerId"])
    .index("by_handle", ["handle"])
    .index("owner_by_handle", ["ownerId", "handle"]),

  drafts: defineTable({
    ownerId: v.optional(v.string()),
    draftId: v.string(),
    conversationId: v.string(),
    kind: v.string(),
    summary: v.string(),
    payload: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("rejected"),
      v.literal("expired"),
    ),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  }).index("by_ownerId", ["ownerId"])
    .index("by_draft_id", ["draftId"])
    .index("owner_by_draft_id", ["ownerId", "draftId"])
    .index("by_conversation_status", ["conversationId", "status"])
    .index("owner_by_conversation_status", ["ownerId", "conversationId", "status"]),

  consolidationRuns: defineTable({
    ownerId: v.optional(v.string()),
    runId: v.string(),
    trigger: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    proposalsCount: v.number(),
    mergedCount: v.number(),
    prunedCount: v.number(),
    notes: v.optional(v.string()),
    // JSON blob: { proposals: [...], decisions: [...], applied: [...] }
    // Captured so you can inspect the reasoning for any historical run.
    details: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_ownerId", ["ownerId"])
    .index("by_run_id", ["runId"])
    .index("owner_by_run_id", ["ownerId", "runId"])
    .index("by_status", ["status"])
    .index("owner_by_status", ["ownerId", "status"]),

  // Runtime overrides for things normally pinned by env vars (e.g. the Claude
  // model). Lets the user say "use opus" via iMessage and have the next agent
  // run respect it without a redeploy.
  settings: defineTable({
    ownerId: v.optional(v.string()),
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_ownerId", ["ownerId"])
    .index("by_key", ["key"])
    .index("owner_by_key", ["ownerId", "key"]),

  automationRuns: defineTable({
    ownerId: v.optional(v.string()),
    runId: v.string(),
    automationId: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    agentId: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_ownerId", ["ownerId"])
    .index("by_automation", ["automationId"])
    .index("owner_by_automation", ["ownerId", "automationId"])
    .index("by_run_id", ["runId"])
    .index("owner_by_run_id", ["ownerId", "runId"]),
});
