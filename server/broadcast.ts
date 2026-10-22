import type { WebSocket } from "ws";
import { currentOwner } from "./workspace-context.js";

type Client = WebSocket;
const clients = new Map<Client, string>();

export function addClient(ws: Client, owner: string): void {
  clients.set(ws, owner);
  ws.on("close", () => clients.delete(ws));
}

export function broadcast(event: string, data: unknown): void {
  const payload = JSON.stringify({ event, data, at: Date.now() });
  const owner = currentOwner();
  for (const [ws, clientOwner] of clients) {
    if (clientOwner === owner && ws.readyState === 1) ws.send(payload);
  }
}
