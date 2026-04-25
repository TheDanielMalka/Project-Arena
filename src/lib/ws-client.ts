import { useEffect, useRef } from "react";
import { ENGINE_BASE } from "@/lib/engine-api";
import { readStoredAccessToken } from "@/lib/authStorage";

// Feature flag — set VITE_ENABLE_WS=true in .env to activate.
// When false, connect() is a no-op and polling hooks remain active.
const WS_ENABLED =
  (import.meta.env.VITE_ENABLE_WS as string | undefined)?.trim() === "true";

// ── Wire types ────────────────────────────────────────────────────────────────

export type WsEventType =
  | "ws:connected"
  | "ws:subscribed"
  | "match:status_changed"
  | "match:roster_updated"
  | "match:forfeit_warning"
  | "match:forfeit_warning_cleared"
  | "match:live_score"
  | "notification:new"
  | "user:profile_updated"
  | "client:status_changed";

export interface WsEnvelope {
  type: WsEventType;
  data: Record<string, unknown>;
}

type Handler = (data: Record<string, unknown>) => void;

// ── Backoff constants ─────────────────────────────────────────────────────────

const BACKOFF_INIT_MS  = 1_000;
const BACKOFF_MAX_MS   = 30_000;
const BACKOFF_FACTOR   = 2;

// ── Client class ──────────────────────────────────────────────────────────────

class WsClient {
  private _ws: WebSocket | null = null;
  private _handlers = new Map<WsEventType, Set<Handler>>();
  private _backoff = BACKOFF_INIT_MS;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _closed = false;
  private _currentToken: string | null = null;

  private get _wsUrl(): string {
    const base = ENGINE_BASE.trim().replace(/\/$/, "");
    let wsBase: string;
    if (base.startsWith("http")) {
      // Absolute URL: http(s):// → ws(s)://
      wsBase = base.replace(/^http/, "ws");
    } else {
      // Relative path ("/api"): derive protocol from page
      const proto = location.protocol === "https:" ? "wss" : "ws";
      wsBase = `${proto}://${location.host}${base}`;
    }
    const token = this._currentToken ?? readStoredAccessToken();
    return token ? `${wsBase}/ws?token=${encodeURIComponent(token)}` : `${wsBase}/ws`;
  }

  connect(token?: string): void {
    if (!WS_ENABLED) return;
    this._closed = false;
    if (token) this._currentToken = token;
    this._clearReconnectTimer();
    this._open();
  }

  disconnect(): void {
    this._closed = true;
    this._clearReconnectTimer();
    this._close();
  }

  get connected(): boolean {
    return this._ws !== null && this._ws.readyState === WebSocket.OPEN;
  }

  subscribe(eventType: WsEventType, handler: Handler): void {
    if (!this._handlers.has(eventType)) {
      this._handlers.set(eventType, new Set());
    }
    this._handlers.get(eventType)!.add(handler);
  }

  unsubscribe(eventType: WsEventType, handler: Handler): void {
    this._handlers.get(eventType)?.delete(handler);
  }

  send(type: string, data: Record<string, unknown>): void {
    if (!this.connected || !this._ws) return;
    this._ws.send(JSON.stringify({ type, data }));
  }

  subscribeMatch(matchId: string): void {
    this.send("ws:subscribe_match", { match_id: matchId });
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _open(): void {
    const token = this._currentToken ?? readStoredAccessToken();
    if (!token) return;

    const url = this._wsUrl;
    const ws = new WebSocket(url);
    this._ws = ws;

    ws.onopen = () => {
      this._backoff = BACKOFF_INIT_MS;
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      let envelope: WsEnvelope;
      try {
        envelope = JSON.parse(ev.data) as WsEnvelope;
      } catch {
        return;
      }
      const handlers = this._handlers.get(envelope.type);
      if (!handlers) return;
      for (const h of handlers) {
        try { h(envelope.data); } catch { /* handler errors must not crash the loop */ }
      }
    };

    ws.onclose = (ev: CloseEvent) => {
      this._ws = null;
      if (this._closed) return;
      // 4001 = auth rejected by server — token bad/expired, do not retry.
      if (ev.code === 4001) {
        console.warn("[Arena WS] auth rejected (4001) — not retrying");
        return;
      }
      this._scheduleReconnect();
    };

    ws.onerror = () => {
      // onerror is always followed by onclose — let onclose drive reconnect
    };
  }

  private _close(): void {
    if (!this._ws) return;
    const ws = this._ws;
    this._ws = null;
    try { ws.close(); } catch { /* ignore */ }
  }

  private _scheduleReconnect(): void {
    this._clearReconnectTimer();
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._backoff = Math.min(this._backoff * BACKOFF_FACTOR, BACKOFF_MAX_MS);
      this._open();
    }, this._backoff);
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const wsClient = new WsClient();

// ── React hook ───────────────────────────────────────────────────────────────

export function useWsEvent(
  eventType: WsEventType,
  handler: (data: Record<string, unknown>) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const stable: Handler = (data) => handlerRef.current(data);
    wsClient.subscribe(eventType, stable);
    return () => wsClient.unsubscribe(eventType, stable);
  }, [eventType]);
}
