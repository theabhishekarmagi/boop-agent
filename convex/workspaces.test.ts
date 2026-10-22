/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { OPERATOR_OWNER, RUNTIME_ISSUER } from "./model/auth";
const modules = import.meta.glob("./**/*.ts");
const identity = (name: string) => ({ subject: name, issuer: "https://auth.example", tokenIdentifier: `https://auth.example|${name}` });
const memory = (content: string) => ({ memoryId: "same-memory-id", content, tier: "long" as const, segment: "preference" as const, importance: 1, decayRate: 0, embedding: [1, ...Array(1023).fill(0)] });

describe("workspace isolation", () => {
  test("anonymous callers cannot read or write business data", async () => {
    const t = convexTest(schema, modules);
    for (const query of [api.dashboard.metrics, api.agents.list, api.memoryRecords.list, api.conversations.list, api.automations.list, api.drafts.recent, api.consolidation.listRuns, api.memoryEvents.recent, api.usageRecords.recent]) {
      await expect(t.query(query, {})).rejects.toThrow("Sign in required");
    }
    await expect(t.mutation(api.messages.send, { conversationId: "web:same", role: "user", content: "bad" })).rejects.toThrow("Sign in required");
    await expect(t.mutation(api.settings.set, { key: "model", value: "bad" })).rejects.toThrow("Sign in required");
  });

  test("messages, metrics, settings, agents and logs belong to each identity even with identical business IDs", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(identity("alice")), b = t.withIdentity(identity("bob"));
    for (const [user, label] of [[a, "A"], [b, "B"]] as const) {
      await user.mutation(api.messages.send, { conversationId: "web:same", role: "user", content: label });
      await user.mutation(api.settings.set, { key: "model", value: label });
      await user.mutation(api.agents.create, { agentId: "same-agent", name: label, task: label, mcpServers: [] });
      await user.mutation(api.agents.addLog, { agentId: "same-agent", logType: "text", content: label });
    }
    for (const [user, label] of [[a, "A"], [b, "B"]] as const) {
      expect((await user.query(api.messages.list, { conversationId: "web:same" })).map(x => x.content)).toEqual([label]);
      expect((await user.query(api.conversations.list, {}))).toHaveLength(1);
      expect((await user.query(api.dashboard.metrics, {})).messages).toBe(1);
      expect(await user.query(api.settings.get, { key: "model" })).toBe(label);
      expect((await user.query(api.agents.get, { agentId: "same-agent" }))?.name).toBe(label);
      expect((await user.query(api.agents.getLogs, { agentId: "same-agent" })).map(x => x.content)).toEqual([label]);
    }
    await b.mutation(api.agents.update, { agentId: "same-agent", status: "cancelled" });
    expect((await a.query(api.agents.get, { agentId: "same-agent" }))?.status).toBe("spawned");
    await a.mutation(api.agents.create, { agentId: "alice-only", name: "A", task: "private", mcpServers: [] });
    expect(await b.query(api.agents.get, { agentId: "alice-only" })).toBeNull();
    expect(await b.mutation(api.agents.update, { agentId: "alice-only", status: "failed" })).toBeNull();
  });

  test("memory recall, vector search, guessed database IDs and supersedes cannot cross accounts", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(identity("alice")), b = t.withIdentity(identity("bob"));
    const aid = await a.mutation(api.memoryRecords.upsert, memory("A secret"));
    const bid = await b.mutation(api.memoryRecords.upsert, memory("B secret"));
    expect((await b.query(api.memoryRecords.getByIds, { ids: [aid, bid] })).map(x => x.content)).toEqual(["B secret"]);
    expect((await b.query(api.memoryRecords.search, { query: "secret" })).map(x => x.content)).toEqual(["B secret"]);
    expect((await b.action(api.memoryRecords.vectorSearch, { embedding: memory("").embedding })).map(x => x.record.content)).toEqual(["B secret"]);
    await b.mutation(api.memoryRecords.upsert, { ...memory("replacement"), memoryId: "replacement", supersedes: ["same-memory-id"] });
    expect((await a.query(api.memoryRecords.getByIds, { ids: [aid] }))[0].lifecycle).toBe("active");
    expect((await a.query(api.memoryRecords.embeddingStats, {})).total).toBe(1);
    expect((await a.query(api.memoryRecords.countsByTier, {})).long).toBe(1);
  });

  test("drafts, automations, usage, events and consolidation are isolated", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(identity("alice")), b = t.withIdentity(identity("bob"));
    await a.mutation(api.drafts.create, { draftId: "draft", conversationId: "web:same", kind: "email", summary: "private", payload: "{}" });
    await a.mutation(api.automations.create, { automationId: "auto", name: "private", task: "private", integrations: [], schedule: "0 9 * * *" });
    await a.mutation(api.automations.createRun, { automationId: "auto", runId: "run" });
    await a.mutation(api.consolidation.createRun, { runId: "merge", trigger: "manual" });
    await a.mutation(api.memoryEvents.emit, { eventType: "private", data: "private" });
    await a.mutation(api.usageRecords.record, { source: "dispatcher", model: "test", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1, durationMs: 1 });
    for (const query of [api.drafts.recent, api.automations.list, api.automations.recentRuns, api.consolidation.listRuns, api.memoryEvents.recent, api.usageRecords.recent]) {
      expect(await b.query(query, {})).toEqual([]);
    }
    expect(await b.mutation(api.drafts.setStatus, { draftId: "draft", status: "sent" })).toBeNull();
    expect(await b.mutation(api.automations.remove, { automationId: "auto" })).toBeNull();
    expect(await b.mutation(api.automations.updateRun, { runId: "run", status: "failed" })).toBeNull();
    expect(await b.mutation(api.consolidation.updateRun, { runId: "merge", status: "failed" })).toBeNull();
    expect((await a.query(api.drafts.get, { draftId: "draft" }))?.status).toBe("pending");
    expect((await a.query(api.automations.get, { automationId: "auto" }))?.enabled).toBe(true);
    expect((await b.query(api.usageRecords.summary, {})).totalCost).toBe(0);
  });

  test("old unowned data stays quarantined and ownership cannot be supplied as an argument", async () => {
    const t = convexTest(schema, modules);
    await t.run(ctx => ctx.db.insert("messages", { conversationId: "web:same", content: "legacy", role: "user", createdAt: 1 }));
    const a = t.withIdentity(identity("alice"));
    expect(await a.query(api.messages.list, { conversationId: "web:same" })).toEqual([]);
    await expect(a.mutation(api.settings.set, { key: "model", value: "test", ownerId: identity("bob").tokenIdentifier } as never)).rejects.toThrow();
    // A similarly named subject from another issuer is a separate identity.
    const otherIssuer = t.withIdentity({ ...identity("alice"), issuer: "https://another.example", tokenIdentifier: "https://another.example|alice" });
    await a.mutation(api.settings.set, { key: "model", value: "A" });
    expect(await otherIssuer.query(api.settings.get, { key: "model" })).toBeNull();
  });

  test("only trusted runtime identities can delegate or enumerate workspaces", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(identity("alice"));
    await a.mutation(api.workspaces.ensure, {});
    await expect(a.query(api.workspaces.forWorker, { paginationOpts: { cursor: null, numItems: 100 } })).rejects.toThrow("Worker access required");
    const forgedClaim = t.withIdentity({ ...identity("bob"), workspace: identity("alice").tokenIdentifier });
    await a.mutation(api.settings.set, { key: "model", value: "A" });
    expect(await forgedClaim.query(api.settings.get, { key: "model" })).toBeNull();
    const worker = t.withIdentity({ subject: "agent-worker", issuer: RUNTIME_ISSUER, workspace: identity("alice").tokenIdentifier });
    expect(await worker.query(api.settings.get, { key: "model" })).toBe("A");
    const operator = t.withIdentity({ subject: "agent-worker", issuer: RUNTIME_ISSUER, workspace: OPERATOR_OWNER });
    expect((await operator.query(api.workspaces.forWorker, { paginationOpts: { cursor: null, numItems: 100 } })).page).toHaveLength(1);
  });
});
