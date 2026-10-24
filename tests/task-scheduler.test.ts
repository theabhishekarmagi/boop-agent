import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskScheduler, type TaskOutcome } from "../server/task-scheduler.js";
import { runInWorkspace, currentOwner } from "../server/workspace-context.js";
const ok: TaskOutcome = { status: "completed", result: "done" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function base(id: string, owner = "alice") {
  return { id, owner, conversationId: "web:chat", name: id, task: id, finish: async () => {} };
}

test("two independent tasks run before either task finishes, while a dependent waits for actual results", async () => {
  const scheduler = new TaskScheduler(3);
  const first = deferred<TaskOutcome>(), second = deferred<TaskOutcome>();
  const started: string[] = [];
  scheduler.admit({ ...base("research"), run: async () => { started.push("research"); return first.promise; } });
  scheduler.admit({ ...base("gmail"), run: async () => { started.push("gmail"); return second.promise; } });
  scheduler.admit({ ...base("summary"), dependencies: ["research"], run: async parents => {
    started.push("summary"); assert.deepEqual(parents, [{ id: "research", name: "research", result: "research results" }]); return ok;
  } });
  await tick();
  assert.deepEqual(started, ["research", "gmail"]);
  assert.equal(scheduler.list("alice", "web:chat").find(t => t.agentId === "summary")?.status, "queued");
  first.resolve({ status: "completed", result: "research results" }); await tick();
  assert.deepEqual(started, ["research", "gmail", "summary"]);
  // The dependent does not wait for the unrelated Gmail job.
  second.resolve(ok); await scheduler.idle("alice");
});

test("per-account capacity bounds execution without blocking a different account", async () => {
  const scheduler = new TaskScheduler(2);
  const gate = deferred<TaskOutcome>();
  let alice = 0, maxAlice = 0, bob = 0;
  for (let i = 0; i < 4; i++) scheduler.admit({ ...base(`a${i}`), run: async () => {
    alice++; maxAlice = Math.max(maxAlice, alice); await gate.promise; alice--; return ok;
  } });
  scheduler.admit({ ...base("b", "bob"), run: async () => { bob++; return ok; } });
  await tick(); assert.equal(alice, 2); assert.equal(bob, 1);
  gate.resolve(ok); await scheduler.idle("alice"); assert.equal(maxAlice, 2);
});

test("failed or cancelled prerequisites block dependents without executing them", async () => {
  for (const status of ["failed", "cancelled"] as const) {
    const scheduler = new TaskScheduler(); const gate = deferred<TaskOutcome>();
    let executions = 0, outcome: TaskOutcome | undefined;
    scheduler.admit({ ...base("first"), run: async () => gate.promise });
    scheduler.admit({ ...base("second"), dependencies: ["first"], run: async () => { executions++; return ok; }, finish: async result => { outcome = result; } });
    gate.resolve({ status, result: "failed prerequisite" }); await scheduler.idle("alice");
    assert.equal(executions, 0); assert.equal(outcome?.status, "failed");
  }
});

test("queued and running tasks can be cancelled without starting queued work", async () => {
  const scheduler = new TaskScheduler(1); let queuedRuns = 0;
  scheduler.admit({ ...base("running"), run: async (_parents, signal) => {
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); return ok;
  } });
  scheduler.admit({ ...base("queued"), run: async () => { queuedRuns++; return ok; } });
  await tick();
  assert.equal(scheduler.cancel("bob", "running"), false);
  assert.equal(scheduler.cancel("alice", "queued"), true);
  assert.equal(scheduler.cancel("alice", "running"), true);
  await scheduler.idle("alice"); assert.equal(queuedRuns, 0);
});

test("dependencies cannot reference another account, conversation, self, or unknown task", async () => {
  const scheduler = new TaskScheduler();
  scheduler.admit({ ...base("first"), run: async () => ok }); await scheduler.idle("alice");
  assert.throws(() => scheduler.admit({ ...base("second", "bob"), dependencies: ["first"], run: async () => ok }), /Dependency not found/);
  assert.throws(() => scheduler.admit({ ...base("second"), conversationId: "web:other", dependencies: ["first"], run: async () => ok }), /Dependency not found/);
  assert.throws(() => scheduler.admit({ ...base("self"), dependencies: ["self"], run: async () => ok }), /Dependency not found/);
  assert.deepEqual(scheduler.list("bob", "web:chat"), []);
});

test("background callbacks retain their originating workspace when a different account frees capacity", async () => {
  const scheduler = new TaskScheduler(1); const gate = deferred<TaskOutcome>(); const owners: string[] = [];
  const add = (id: string, wait = false) => runInWorkspace("alice", () => scheduler.admit({ ...base(id),
    run: () => runInWorkspace("alice", async () => { owners.push(currentOwner()); return wait ? gate.promise : ok; }),
  }));
  add("first", true); add("second"); await tick();
  runInWorkspace("bob", () => gate.resolve(ok)); await scheduler.idle("alice");
  assert.deepEqual(owners, ["alice", "alice"]);
});

test("a failed completion notification does not block independent tasks or dependency release", async () => {
  const scheduler = new TaskScheduler(1); let secondRuns = 0;
  scheduler.admit({ ...base("first"), run: async () => ok, finish: async () => { throw new Error("delivery failed"); } });
  scheduler.admit({ ...base("second"), dependencies: ["first"], run: async () => { secondRuns++; return ok; } });
  await scheduler.idle("alice"); assert.equal(secondRuns, 1);
});

test("admission limit bounds queued tasks and rejects duplicates", async () => {
  const scheduler = new TaskScheduler(1); const gate = deferred<TaskOutcome>();
  for (let i = 0; i < 20; i++) scheduler.admit({ ...base(`a${i}`), run: async () => gate.promise });
  assert.throws(() => scheduler.admit({ ...base("overflow"), run: async () => ok }), /20 active/);
  assert.throws(() => scheduler.admit({ ...base("a0"), run: async () => ok }), /already admitted/);
  gate.resolve(ok); await scheduler.idle("alice");
});
