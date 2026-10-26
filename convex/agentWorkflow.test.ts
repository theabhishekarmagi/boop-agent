/// <reference types="vite/client" />
import { test, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { RUNTIME_ISSUER } from "./model/auth";
const modules = import.meta.glob("./**/*.ts");
test("Gmail priority workflow survives persistence while remaining account scoped", async () => {
  const t = convexTest(schema, modules);
  const a = t.withIdentity({ issuer:RUNTIME_ISSUER,subject:"worker",workspace:"alice" });
  const b = t.withIdentity({ issuer:RUNTIME_ISSUER,subject:"worker",workspace:"bob" });
  await a.mutation(api.agents.create, {agentId:"triage",name:"Inbox",task:"Overview",mcpServers:["gmail"],workflow:"gmail_priority"});
  expect((await a.query(api.agents.get,{agentId:"triage"}))?.workflow).toBe("gmail_priority");
  expect(await b.query(api.agents.get,{agentId:"triage"})).toBeNull();
  await a.mutation(api.agents.create,{agentId:"legacy",name:"Other",task:"Other work",mcpServers:[]});
  expect((await a.query(api.agents.get,{agentId:"legacy"}))?.workflow).toBeUndefined();
});

test("one provider message claims one agent across retries", async () => {
  const t = convexTest(schema, modules);
  const a = t.withIdentity({ issuer: RUNTIME_ISSUER, subject: "worker", workspace: "alice" });
  const b = t.withIdentity({ issuer: RUNTIME_ISSUER, subject: "worker", workspace: "bob" });
  const args = { agentId: "telegram-turn-1", conversationId: "telegram:one:123", name: "Report", task: "Research and draft", mcpServers: ["googlesuper"] };
  expect(await a.mutation(api.agents.createOnce, args)).toEqual({ created: true, status: "spawned" });
  expect(await a.mutation(api.agents.createOnce, { ...args, task: "worded differently" })).toEqual({ created: false, status: "spawned" });
  expect((await a.query(api.agents.list, {}))).toHaveLength(1);
  expect(await b.mutation(api.agents.createOnce, args)).toEqual({ created: true, status: "spawned" });
});

test("replayed provider turn does not add another inbound message or acknowledgment", async () => {
  const t = convexTest(schema, modules);
  const a = t.withIdentity({ issuer: RUNTIME_ISSUER, subject: "worker", workspace: "alice" });
  const message = { conversationId: "telegram:one:123", turnId: "telegram-update-1", dedupe: true };
  await a.mutation(api.messages.send, { ...message, role: "user", content: "Make one report" });
  await a.mutation(api.messages.send, { ...message, role: "user", content: "Make one report" });
  await a.mutation(api.messages.send, { ...message, role: "assistant", content: "On it" });
  await a.mutation(api.messages.send, { ...message, role: "assistant", content: "On it" });
  expect((await a.query(api.messages.byTurn, { conversationId: message.conversationId, turnId: message.turnId }))).toHaveLength(2);
});

test("Google Doc approval is claimed once and cannot be marked sent before proof", async () => {
  const t = convexTest(schema, modules);
  const a = t.withIdentity({ issuer: RUNTIME_ISSUER, subject: "worker", workspace: "alice" });
  const b = t.withIdentity({ issuer: RUNTIME_ISSUER, subject: "worker", workspace: "bob" });
  await a.mutation(api.drafts.create, { draftId: "doc", conversationId: "web:a", kind: "gdocs.create",
    summary: "Create report", payload: JSON.stringify({ title: "Report", markdown_text: "# Report" }) });
  await expect(a.mutation(api.drafts.setStatus, { draftId: "doc", status: "sent" })).rejects.toThrow();
  await expect(b.mutation(api.drafts.claimGoogleDocCreation, { draftId: "doc", conversationId: "web:a" })).rejects.toThrow();
  await expect(a.mutation(api.drafts.claimGoogleDocCreation, { draftId: "doc", conversationId: "web:other" })).rejects.toThrow();
  await a.mutation(api.drafts.claimGoogleDocCreation, { draftId: "doc", conversationId: "web:a" });
  await expect(a.mutation(api.drafts.claimGoogleDocCreation, { draftId: "doc", conversationId: "web:a" })).rejects.toThrow(/already decided/);
  await a.mutation(api.drafts.finishGoogleDocCreation, { draftId: "doc", status: "sent", note: "https://docs.google.com/document/d/example/edit" });
  expect((await a.query(api.drafts.get, { draftId: "doc" }))?.status).toBe("sent");
});
