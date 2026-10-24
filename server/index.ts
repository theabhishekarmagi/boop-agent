import "./env-setup.js";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { addClient } from "./broadcast.js";
import { createSendblueRouter } from "./sendblue.js";
import { handleUserMessage } from "./interaction-agent.js";
import { loadIntegrations } from "./integrations/registry.js";
import { startCleanupLoop } from "./memory/clean.js";
import { startAutomationLoop } from "./automations.js";
import { startHeartbeatLoop, recoverTasksOnStartup } from "./heartbeat.js";
import { startConsolidationLoop } from "./consolidation.js";
import { cancelAgent, retryAgent } from "./execution-agent.js";
import { createComposioRouter } from "./composio-routes.js";
import { ensureProactiveWatcher } from "./proactive-email.js";
import { preloadLocalModel } from "./embeddings.js";
import { createMemoryRouter } from "./memory-routes.js";
import { startTelegramLoop } from "./telegram.js";
import { startTwilioWhatsApp, twilioWhatsAppStatus } from "./twilio-whatsapp.js";
import { convex } from "./convex-client.js";
import { api } from "../convex/_generated/api.js";
import { broadcast } from "./broadcast.js";
import { OPERATOR_OWNER, runInWorkspace } from "./workspace-context.js";
import { requireBrowserSession, verifyBrowserToken } from "./browser-auth.js";

async function main() {
  if (process.env.BOOP_PUBLIC_MODE === "true") {
    throw new Error("This main-based branch is a personal agent. Use a separate personal development environment with BOOP_PUBLIC_MODE=false; the public multi-user flow lives on stagging.");
  }
  if (process.env.BOOP_HOSTED_PREVIEW === "true" &&
      ((!process.env.BOOP_ALLOWED_EMAILS?.trim() && process.env.BOOP_ALLOW_PUBLIC_SIGNUPS !== "true") || !process.env.CONVEX_URL?.startsWith("https://"))) {
    throw new Error("Hosted preview requires an email allowlist or explicit public signups, and an HTTPS Convex deployment");
  }
  await recoverTasksOnStartup();
  const whatsapp = await startTwilioWhatsApp({
    generate: (conversationId, content) => handleUserMessage({ conversationId, content }),
    record: async (conversationId, content) => {
      await convex.mutation(api.messages.send, { conversationId, role: "assistant", content });
      broadcast("whatsapp_reply", { conversationId });
    },
  });
  await loadIntegrations();
  startTelegramLoop();
  startCleanupLoop();
  startAutomationLoop();
  startHeartbeatLoop();
  startConsolidationLoop();
  // No-op when a paid embedding key is set; otherwise downloads/loads the
  // local BGE-large model in the background so the first user-facing
  // recall() doesn't pay the model-load cost.
  preloadLocalModel();

  // If a stable public URL is configured, register the Composio webhook +
  // Gmail trigger now. For ngrok-based dev, scripts/dev.mjs drives the same
  // function once the ngrok URL is known, so we skip when only the local
  // PORT default is available.
  const stableUrl = process.env.PUBLIC_URL;
  if (stableUrl && !stableUrl.includes("localhost")) {
    ensureProactiveWatcher(stableUrl).catch((err) =>
      console.error("[proactive] startup failed", err),
    );
  }

  const app = express();
  app.use(cors());
  // Composio webhook receiver must read raw bytes for HMAC verification, so
  // its body parser is mounted BEFORE the global express.json. Without this
  // ordering the JSON parser consumes the stream first and the raw buffer
  // arrives empty.
  app.use("/composio/webhook", express.raw({ type: "application/json", limit: "2mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "boop-agent", whatsapp: twilioWhatsAppStatus() });
  });

  const operatorContext: express.RequestHandler = (_req, _res, next) => runInWorkspace(OPERATOR_OWNER, next);
  if (whatsapp) app.use("/twilio/whatsapp", operatorContext, whatsapp.router);
  app.use("/sendblue", operatorContext, createSendblueRouter());
  app.use("/composio", (req, res, next) => {
    if (req.method === "POST" && req.path === "/webhook") operatorContext(req, res, next);
    else void requireBrowserSession(req, res, next);
  }, createComposioRouter());
  app.use(requireBrowserSession);
  app.use("/memory", createMemoryRouter());

  app.post("/agents/:id/cancel", async (req, res) => {
    try {
      const agentId = req.params.id;
      const agent = await convex.query(api.agents.get, { agentId });
      if (!agent) { res.status(404).json({ error: "Task not found" }); return; }
      if (agent.status === "running" || agent.status === "spawned") {
        cancelAgent(agentId);
        // Also settle orphaned records left by a local process restart.
        await convex.mutation(api.agents.update, { agentId, status: "cancelled", error: "Stopped by user." });
        broadcast("agent_done", { agentId, status: "cancelled" });
      }
      res.json({ ok: true });
    } catch { res.status(500).json({ error: "Unable to cancel task" }); }
  });

  app.post("/consolidate", async (_req, res) => {
    try {
      const { runConsolidation } = await import("./consolidation.js");
      // Fire-and-forget so the HTTP request returns immediately.
      runConsolidation("manual").catch((err) =>
        console.error("[consolidation] manual run failed", err),
      );
      res.json({ ok: true, triggered: "manual" });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/agents/:id/retry", async (req, res) => {
    const result = await retryAgent(req.params.id);
    if (!result) {
      res.status(404).json({ error: "agent not found" });
      return;
    }
    res.json(result);
  });

  // Chat endpoint for local testing and the debug dashboard
  app.post("/chat", async (req, res) => {
    const { conversationId, content } = req.body ?? {};
    if (typeof conversationId !== "string" || !conversationId.startsWith("web:") ||
        conversationId.length > 200 || typeof content !== "string" || !content.trim() || content.length > 20000) {
      res.status(400).json({ error: "A web: conversationId and message content are required" });
      return;
    }
    try {
      const reply = await handleUserMessage({ conversationId, content });
      await convex.mutation(api.messages.send, { conversationId, role: "assistant", content: reply });
      res.json({ reply });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: String(err) });
    }
  });

  const server = createServer(app);
  // Tunnel only this small receiver, never the personal dashboard /chat APIs.
  const webhookApp = express();
  if (whatsapp) webhookApp.use("/twilio/whatsapp", operatorContext, whatsapp.router);
  const webhookServer = whatsapp ? createServer(webhookApp) : undefined;
  webhookServer?.listen(Number(process.env.TWILIO_WHATSAPP_WEBHOOK_PORT ?? 3457), "127.0.0.1", () => {
    console.log(`[whatsapp] Webhook-only listener on 127.0.0.1:${process.env.TWILIO_WHATSAPP_WEBHOOK_PORT ?? 3457}`);
  });
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 20_000 });
  wss.on("connection", (ws) => {
    const timeout = setTimeout(() => ws.close(4401, "Sign in required"), 10_000);
    let sessionCheck: ReturnType<typeof setInterval> | undefined;
    ws.once("message", async (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type !== "auth" || typeof message.token !== "string") throw new Error("Invalid auth");
        const owner = await verifyBrowserToken(message.token);
        if (ws.readyState !== 1) return;
        clearTimeout(timeout);
        addClient(ws, owner);
        ws.send(JSON.stringify({ event: "hello", data: { ok: true }, at: Date.now() }));
        sessionCheck = setInterval(() => {
          void verifyBrowserToken(message.token).then(current => {
            if (current !== owner) ws.close(4401, "Session changed");
          }).catch(() => ws.close(4401, "Session expired"));
        }, 30_000);
        sessionCheck.unref();
      } catch { ws.close(4401, "Sign in required"); }
    });
    ws.on("close", () => { clearTimeout(timeout); if (sessionCheck) clearInterval(sessionCheck); });
  });

  const port = Number(process.env.PORT ?? 3456);
  server.listen(port, () => {
    console.log(`boop-agent server listening on :${port}`);
    console.log(`  health      GET  http://localhost:${port}/health`);
    console.log(`  chat        POST http://localhost:${port}/chat`);
    console.log(`  sendblue    POST http://localhost:${port}/sendblue/webhook`);
    console.log(`  websocket   WS   ws://localhost:${port}/ws`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close();
      webhookServer?.close();
      void whatsapp?.stop().finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 25_000).unref();
    });
  }
}

runInWorkspace(OPERATOR_OWNER, main).catch((err) => {
  console.error("fatal", err);
  process.exit(1);
});
