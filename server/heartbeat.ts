import { forEachWorkspace } from "./workspace-jobs.js";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { cancelAgent, runningAgentIds, runningAgentStartedAt } from "./execution-agent.js";
import { broadcast } from "./broadcast.js";

const STALE_MS = 15 * 60 * 1000;

export async function sweepStaleAgents(): Promise<void> {
  const [executing, queued] = await Promise.all([
    convex.query(api.agents.list, { status: "running", limit: 100 }),
    convex.query(api.agents.list, { status: "spawned", limit: 100 }),
  ]);
  const runningInDb = [...executing, ...queued];
  const now = Date.now();
  const live = new Set(runningAgentIds());

  for (const a of runningInDb) {
    const age = now - (runningAgentStartedAt(a.agentId) ?? a.startedAt);
    if (age < STALE_MS || (a.status === "spawned" && live.has(a.agentId))) continue;

    if (live.has(a.agentId)) {
      cancelAgent(a.agentId);
    }
    await convex.mutation(api.agents.update, {
      agentId: a.agentId,
      status: "failed",
      error: `Marked failed after ${Math.round(age / 1000)}s (stale heartbeat).`,
    });
    broadcast("agent_stale", { agentId: a.agentId });
  }
}

export function startHeartbeatLoop(intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    forEachWorkspace(() => sweepStaleAgents()).catch((err) => console.error("[heartbeat] sweep error", err));
  }, intervalMs);
  return () => clearInterval(timer);
}

// Called before admitting any new channel jobs on this single-worker server.
export async function reconcileInterruptedAgents(deps: {
  list: (status: "running" | "spawned") => Promise<Array<{ agentId: string }>>;
  live: () => string[];
  fail: (agentId: string) => Promise<void>;
} = {
  list: (status: "running" | "spawned") => convex.query(api.agents.list, { status, limit: 100 }),
  live: runningAgentIds,
  fail: async (agentId: string) => {
    await convex.mutation(api.agents.update, { agentId, status: "failed",
      error: "Interrupted by a server restart. This task was not resumed; review completed steps before retrying." });
    broadcast("agent_stale", { agentId, error: "Interrupted by server restart" });
  },
}) {
  const live = new Set(deps.live());
  const records = (await Promise.all([deps.list("running"), deps.list("spawned")])).flat();
  for (const record of records) if (!live.has(record.agentId)) await deps.fail(record.agentId);
}

export async function recoverTasksOnStartup(deps = {
  recover: () => forEachWorkspace(() => reconcileInterruptedAgents()),
  wait: () => new Promise<void>(resolve => setTimeout(resolve, 1000)),
}) {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try { await deps.recover(); return; }
    catch (error) {
      if (attempt === 30) throw error;
      if (attempt === 1) console.warn("[startup] Waiting for task storage before accepting messages.");
      await deps.wait();
    }
  }
}
