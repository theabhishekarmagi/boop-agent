import { test } from "node:test";
import assert from "node:assert/strict";
import { registerIntegration, buildMcpServersForIntegrations } from "../server/integrations/registry.js";
import { runInWorkspace } from "../server/workspace-context.js";

test("integration startup overlaps independent sessions, deduplicates names, and isolates owners", async () => {
  await runInWorkspace("startup-test-a", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started: string[] = [];
    for (const name of ["one", "two"]) registerIntegration({ name, description: name,
      createServer: async () => { started.push(name); await gate; return { name, tools: [] }; },
    });
    const building = buildMcpServersForIntegrations(["one", "two", "one"]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, ["one", "two"]);
    release();
    assert.deepEqual(Object.keys(await building), ["one", "two"]);
  });
  await runInWorkspace("startup-test-b", async () => {
    assert.deepEqual(await buildMcpServersForIntegrations(["one"]), {});
  });
});
