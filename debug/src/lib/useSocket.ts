import { useEffect, useRef, useState } from "react";
import { publicToken } from "./publicAuth.js";

export interface SocketEvent {
  event: string;
  data: unknown;
  at: number;
}

export function useSocket(onEvent?: (e: SocketEvent) => void) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}/ws`;
      ws = new WebSocket(url);
      ws.onopen = async () => {
        if (import.meta.env.VITE_BOOP_PUBLIC_MODE === "true") {
          const token = await publicToken();
          if (!token || cancelled) { ws?.close(); return; }
          ws?.send(JSON.stringify({ type: "authenticate", token }));
        } else setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as SocketEvent;
          if (parsed.event === "hello") setConnected(true);
          handlerRef.current?.(parsed);
        } catch {
          /* ignore */
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return { connected };
}
