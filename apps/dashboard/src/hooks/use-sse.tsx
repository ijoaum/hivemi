"use client";

import { useEffect, useState, useCallback, useRef } from "react";

type EventType = "agent:status" | "task:status" | "task:created" | "log:new" | "connected" | "heartbeat";

interface SSEEvent {
  type: EventType;
  data?: unknown;
  timestamp: string;
}

export function useSSE(url: string = "/api/events") {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const listenersRef = useRef<Map<EventType, Set<(data: unknown) => void>>>(new Map());

  useEffect(() => {
    if (typeof window === "undefined") return;

    const connect = () => {
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log("[SSE] Connected");
        setIsConnected(true);
      };

      eventSource.onerror = () => {
        console.log("[SSE] Error, reconnecting...");
        setIsConnected(false);
        eventSource.close();
        setTimeout(connect, 5000);
      };

      eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as SSEEvent;
          setLastEvent(parsed);
          
          const listeners = listenersRef.current.get(parsed.type);
          if (listeners) {
            listeners.forEach(cb => cb(parsed.data));
          }
        } catch (err) {
          console.error("[SSE] Failed to parse:", err);
        }
      };
    };

    connect();

    return () => {
      eventSourceRef.current?.close();
    };
  }, [url]);

  const subscribe = useCallback((type: EventType, callback: (data: unknown) => void) => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }
    listenersRef.current.get(type)!.add(callback);

    return () => {
      listenersRef.current.get(type)?.delete(callback);
    };
  }, []);

  return { isConnected, lastEvent, subscribe };
}
