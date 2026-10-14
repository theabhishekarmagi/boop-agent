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
import { startHeartbeatLoop } from "./heartbeat.js";
import { startConsolidationLoop } from "./consolidation.js";
import { cancelAgent, retryAgent } from "./execution-agent.js";
import { createComposioRouter } from "./composio-routes.js";
import { ensureProactiveWatcher } from "./proactive-email.js";
import { preloadLocalModel } from "./embeddings.js";
import { createMemoryRouter } from "./memory-routes.js";
import { startTelegramLoop } from "./telegram.js";
import { startWhatsApp, whatsAppStatus } from "./whatsapp.js";
import { publicAuthentication, authenticatePublicToken, allowedOrigins } from "./public-auth.js";
import { createPublicWhatsAppRouter } from "./public-whatsapp.js";
import { publicMode, tenantActor } from "./tenant-context.js";
import { convex } from "./convex-client.js";
import { api } from "../convex/_generated/api.js";

async function main() {
  if (publicMode()) {
    if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_JWT_ISSUER_DOMAIN || !allowedOrigins().length) throw new Error("Configure Clerk and BOOP_ALLOWED_ORIGINS before enabling public mode");
    const security = await convex.query(api.publicAccounts.securityStatus, {});
    if (!security.requiresAuth || !security.clerkConfigured) throw new Error("Enable authentication on the Convex deployment before public mode");
  }
  await loadIntegrations();
  if (!publicMode()) startTelegramLoop();
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
  if (!publicMode() && stableUrl && !stableUrl.includes("localhost")) {
    ensureProactiveWatcher(stableUrl).catch((err) =>
      console.error("[proactive] startup failed", err),
    );
  }

  const app = express();
  app.use(cors(publicMode() ? { origin: allowedOrigins() } : undefined));
  // Composio webhook receiver must read raw bytes for HMAC verification, so
  // its body parser is mounted BEFORE the global express.json. Without this
  // ordering the JSON parser consumes the stream first and the raw buffer
  // arrives empty.
  app.use("/composio/webhook", express.raw({ type: "application/json", limit: "2mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "boop-agent", whatsapp: whatsAppStatus() });
  });

  // Legacy personal channel webhooks are not a public-user identity boundary.
  if (!publicMode()) app.use("/sendblue", createSendblueRouter());
  app.use(publicAuthentication);
  app.use("/whatsapp", createPublicWhatsAppRouter());
  app.use("/composio", createComposioRouter());
  app.use("/memory", createMemoryRouter());

  app.post("/agents/:id/cancel", async (req, res) => {
    if (publicMode() && !await convex.query(api.agents.get, { agentId: req.params.id })) { res.status(404).json({ error: "Agent not found" }); return; }
    const ok = cancelAgent(req.params.id);
    res.json({ ok });
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
      res.status(500).json({ error: publicMode() ? "Unable to process this request. Please try again." : String(err) });
    }
  });

  app.post("/agents/:id/retry", async (req, res) => {
    if (publicMode() && !await convex.query(api.agents.get, { agentId: req.params.id })) { res.status(404).json({ error: "Agent not found" }); return; }
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
    if (!conversationId || !content) {
      res.status(400).json({ error: "conversationId and content required" });
      return;
    }
    try {
      const reply = await handleUserMessage({ conversationId, content });
      res.json({ reply });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: publicMode() ? "Unable to process this request. Please try again." : String(err) });
    }
  });

  app.use(((error, _req, res, next) => {
    if (!publicMode()) { next(error); return; }
    console.warn("[public-api] Request failed; details kept out of the response.");
    if (!res.headersSent) res.status(503).json({ error: "This request is temporarily unavailable. Please try again." });
  }) as express.ErrorRequestHandler);
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    const accept = (ownerId?: string) => {
      addClient(ws, ownerId);
      ws.send(JSON.stringify({ event: "hello", data: { ok: true }, at: Date.now() }));
    };
    if (!publicMode()) { accept(); return; }
    const timeout = setTimeout(() => ws.close(1008, "Authentication required"), 5000);
    ws.once("message", async (bytes) => {
      try {
        const data = JSON.parse(bytes.toString());
        if (data.type !== "authenticate" || typeof data.token !== "string") throw new Error("auth");
        const actor = await authenticatePublicToken(data.token);
        clearTimeout(timeout); accept(actor.ownerId);
        // Require fresh authentication periodically; a revoked login must not
        // retain an indefinitely open dashboard event stream.
        const expiration = setTimeout(() => ws.close(1008, "Refresh authentication"), 60_000);
        ws.once("close", () => clearTimeout(expiration));
      } catch { clearTimeout(timeout); ws.close(1008, "Invalid authentication"); }
    });
  });

  const port = Number(process.env.PORT ?? 3456);
  server.listen(port, () => {
    console.log(`boop-agent server listening on :${port}`);
    console.log(`  health      GET  http://localhost:${port}/health`);
    console.log(`  chat        POST http://localhost:${port}/chat`);
    console.log(`  sendblue    POST http://localhost:${port}/sendblue/webhook`);
    console.log(`  websocket   WS   ws://localhost:${port}/ws`);
    // Start only after binding the port, so a second server cannot open another
    // linked-device session before failing with EADDRINUSE.
    void startWhatsApp().then((stop) => {
      if (!stop) return;
      const shutdown = () => { void stop().finally(() => process.exit(0)); };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }).catch((error) => console.error("[whatsapp] Startup failed:", error instanceof Error ? error.message : "unknown error"));
  });
}

main().catch((err) => {
  console.error("fatal", err);
  process.exit(1);
});
