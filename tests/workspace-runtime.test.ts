import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runInWorkspace, currentOwner, isOperator, OPERATOR_OWNER } from "../server/workspace-context.js";
import { broadcast, addClient } from "../server/broadcast.js";
import type { WebSocket } from "ws";

process.env.CONVEX_URL ??= "http://127.0.0.1:3210";

test("async work keeps the initiating workspace across concurrent awaits", async () => {
  const results = await Promise.all(["alice", "bob"].map(owner => runInWorkspace(owner, async () => {
    await new Promise(resolve => setTimeout(resolve, owner === "alice" ? 10 : 1));
    assert.equal(isOperator(), false);
    return currentOwner();
  })));
  assert.deepEqual(results, ["alice", "bob"]);
  assert.throws(() => currentOwner(), /Workspace context is required/);
  assert.equal(runInWorkspace(OPERATOR_OWNER, isOperator), true);
});

test("live events go only to sockets belonging to the initiating workspace", () => {
  class Socket extends EventEmitter {
    readyState = 1;
    messages: string[] = [];
    send(message: string) { this.messages.push(message); }
  }
  const a = new Socket(), b = new Socket();
  addClient(a as unknown as WebSocket, "alice");
  addClient(b as unknown as WebSocket, "bob");
  runInWorkspace("alice", () => broadcast("private", { secret: "A" }));
  assert.equal(a.messages.length, 1);
  assert.equal(b.messages.length, 0);
  runInWorkspace("bob", () => broadcast("private", { secret: "B" }));
  assert.equal(a.messages.length, 1);
  assert.equal(b.messages.length, 1);
  a.emit("close"); b.emit("close");
});

test("tool registries and Composio identities are different for each account", async () => {
  const { registerIntegration, listIntegrations } = await import("../server/integrations/registry.js");
  const { boopUserId } = await import("../server/composio.js");
  runInWorkspace("alice", () => registerIntegration({ name: "private-tool", description: "Alice only", createServer: async () => { throw new Error("unused"); } }));
  assert.equal(runInWorkspace("bob", listIntegrations).length, 0);
  assert.equal(runInWorkspace("alice", listIntegrations).length, 1);
  assert.notEqual(runInWorkspace("alice", boopUserId), runInWorkspace("bob", boopUserId));
  assert.notEqual(runInWorkspace("alice", boopUserId), runInWorkspace(OPERATOR_OWNER, boopUserId));
});

test("connection mutation rejects a connection outside the authenticated user's filtered list", async (t) => {
  process.env.COMPOSIO_API_KEY = "test-only-not-a-real-key";
  const { getComposio, disconnectToolkit, renameConnection, boopUserId } = await import("../server/composio.js");
  const composio = getComposio()!;
  const list = t.mock.method(composio.connectedAccounts, "list", async () => ({ items: [] }));
  const remove = t.mock.method(composio.connectedAccounts, "delete", async () => { throw new Error("Should not be called"); });
  await runInWorkspace("bob", async () => {
    await assert.rejects(() => disconnectToolkit("alice-connection"), /not found in your workspace/);
    await assert.rejects(() => renameConnection("alice-connection", "stolen"), /not found in your workspace/);
    assert.deepEqual(list.mock.calls[0].arguments[0], { userIds: [boopUserId()] });
  });
  assert.equal(remove.mock.callCount(), 0);
});

test("customer agents cannot deliver through the operator's personal messaging channels", async () => {
  const { deliverToConversation } = await import("../server/message-delivery.js");
  await runInWorkspace("alice", async () => {
    for (const channel of ["sms:+15555555555", "whatsapp:twilio:+15555555555"]) {
      await assert.rejects(() => deliverToConversation(channel, "test"), /no verified messaging channel/);
    }
    await deliverToConversation("web:chat", "test");
  });
});
