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
