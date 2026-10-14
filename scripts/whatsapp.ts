import "../server/env-setup.js";
process.env.BOOP_WHATSAPP_ENABLED = "true";
await import("../server/index.js");
