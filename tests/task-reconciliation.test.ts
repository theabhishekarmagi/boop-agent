import test from "node:test";
import assert from "node:assert/strict";
process.env.CONVEX_URL ??= "https://test.convex.cloud";
const { reconcileInterruptedAgents } = await import("../server/heartbeat.js");

test("startup settles interrupted running and queued records immediately while preserving live jobs", async () => {
  const failed: string[] = [];
  await reconcileInterruptedAgents({
    live: () => ["live"],
    list: async status => status === "running" ? [{agentId:"orphan-running"},{agentId:"live"}] : [{agentId:"orphan-queued"}],
    fail: async id => { failed.push(id); },
  });
  assert.deepEqual(failed, ["orphan-running", "orphan-queued"]);
});

test("startup reconciliation propagates persistence failure rather than admitting new work", async () => {
  await assert.rejects(reconcileInterruptedAgents({live:()=>[],list:async()=>[{agentId:"orphan"}],
    fail:async()=>{throw new Error("database unavailable");},
  }), /database unavailable/);
});

test("startup waits for a cold local database before accepting work, with a bounded retry count", async () => {
  const { recoverTasksOnStartup } = await import("../server/heartbeat.js");
  let attempts = 0, waits = 0;
  await recoverTasksOnStartup({recover:async()=>{if(++attempts<3)throw new Error("database starting");},wait:async()=>{waits++;}});
  assert.equal(attempts,3); assert.equal(waits,2);
  attempts=0;
  await assert.rejects(recoverTasksOnStartup({recover:async()=>{attempts++;throw new Error("offline");},wait:async()=>{}}),/offline/);
  assert.equal(attempts,30);
});
