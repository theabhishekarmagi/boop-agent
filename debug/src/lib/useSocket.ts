import { useEffect, useRef, useState } from "react";
import { sessionToken } from "./api-fetch";

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
      const socket = ws;
      ws.onopen = () => {
        void sessionToken().then(token => {
          if (!cancelled && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "auth", token }));
        }).catch(() => socket.close());
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
