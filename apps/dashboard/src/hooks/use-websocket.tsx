"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";

type EventType = "agent:status" | "task:status" | "task:created" | "log:new";

interface WSEvent {
  type: EventType;
  data: unknown;
  timestamp: string;
}

interface WSContextValue {
  isConnected: boolean;
  subscribe: (type: EventType, callback: (data: unknown) => void) => () => void;
  lastEvent: WSEvent | null;
}

const WSContext = createContext<WSContextValue | null>(null);

export function useWebSocket() {
  const ctx = useContext(WSContext);
  if (!ctx) throw new Error("useWebSocket must be used within WebSocketProvider");
  return ctx;
}

export function useWSEvent(type: EventType, callback: (data: unknown) => void) {
  const { subscribe } = useWebSocket();
  
  useEffect(() => {
    return subscribe(type, callback);
  }, [type, callback, subscribe]);
}

interface WebSocketProviderProps {
  children: ReactNode;
  url?: string;
}

export function WebSocketProvider({ children, url }: WebSocketProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<EventType, Set<(data: unknown) => void>>>(new Map());

  // Derive WebSocket URL from current origin (same-origin)
  const wsUrl = url || (
    typeof window !== "undefined" 
      ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/ws`
      : "ws://localhost:3000/api/ws"
  );

  useEffect(() => {
    // Skip if no WebSocket support or no URL
    if (typeof WebSocket === "undefined") return;

    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let ws: WebSocket;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("[WS] Connected");
          setIsConnected(true);
        };

        ws.onclose = () => {
          console.log("[WS] Disconnected, reconnecting in 5s...");
          setIsConnected(false);
          reconnectTimeout = setTimeout(connect, 5000);
        };

        ws.onerror = (err) => {
          console.error("[WS] Error:", err);
        };

        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data) as WSEvent;
            setLastEvent(parsed);
            
            // Notify subscribers
            const listeners = listenersRef.current.get(parsed.type);
            if (listeners) {
              listeners.forEach(cb => cb(parsed.data));
            }
          } catch (err) {
            console.error("[WS] Failed to parse message:", err);
          }
        };
      } catch (err) {
        console.error("[WS] Failed to connect:", err);
        reconnectTimeout = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      ws?.close();
    };
  }, [wsUrl]);

  const subscribe = useCallback((type: EventType, callback: (data: unknown) => void) => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }
    listenersRef.current.get(type)!.add(callback);

    return () => {
      listenersRef.current.get(type)?.delete(callback);
    };
  }, []);

  return (
    <WSContext.Provider value={{ isConnected, subscribe, lastEvent }}>
      {children}
    </WSContext.Provider>
  );
}

// Fallback provider that does nothing (for when WS is not available)
export function NoopWebSocketProvider({ children }: { children: ReactNode }) {
  const value: WSContextValue = {
    isConnected: false,
    subscribe: () => () => {},
    lastEvent: null,
  };

  return <WSContext.Provider value={value}>{children}</WSContext.Provider>;
}
