import type { WebSocket } from "ws";
import { tenantKey } from "./tenant-context.js";

type Client = WebSocket;
const clients = new Map<Client, string>();

export function addClient(ws: Client, ownerId = tenantKey()): void {
  clients.set(ws, ownerId);
  ws.on("close", () => clients.delete(ws));
}

export function broadcast(event: string, data: unknown): void {
  const payload = JSON.stringify({ event, data, at: Date.now() });
  for (const [ws, ownerId] of clients) {
    if (ownerId === tenantKey() && ws.readyState === 1) ws.send(payload);
  }
}
