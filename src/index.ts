import { createServer } from "http";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { KiteTicker } from "kiteconnect";

const PORT   = Number(process.env.PORT) || 8080;
const SECRET = process.env.BRIDGE_SECRET ?? "";

// ── Types ────────────────────────────────────────────────────────────────────

interface TickerTick {
  instrument_token: number;
  last_price:       number;
  volume:           number;
  oi?:              number;
  average_price?:   number;
  last_quantity?:   number;
  timestamp?:       Date;
  ohlc?: {
    open:  number;
    high:  number;
    low:   number;
    close: number;
  };
}

interface ClientMsg {
  type:         "subscribe" | "unsubscribe" | "ping";
  secret?:      string;
  api_key?:     string;
  token?:       string;
  instruments?: number[];
  mode?:        "ltp" | "quote" | "full";
}

interface BridgeClient {
  authed: boolean;
  ticker: KiteTicker | null;
}

// ── HTTP server (health check) ────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", clients: clients.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });
const clients = new Map<WebSocket, BridgeClient>();

wss.on("connection", (ws: WebSocket) => {
  console.log(`[bridge] client connected  (total: ${clients.size + 1})`);
  clients.set(ws, { authed: false, ticker: null });

  ws.on("message", (raw: RawData) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return; }

    const state = clients.get(ws);
    if (!state) return;

    // ── Auth check (first message must carry secret if SECRET is set) ──
    if (!state.authed) {
      if (SECRET && msg.secret !== SECRET) {
        ws.send(JSON.stringify({ type: "error", error: "Unauthorized" }));
        ws.close(1008, "Unauthorized");
        return;
      }
      state.authed = true;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (msg.type === "subscribe") {
      const { api_key, token, instruments = [], mode = "full" } = msg;
      if (!api_key || !token || !instruments.length) {
        ws.send(JSON.stringify({ type: "error", error: "Missing api_key, token, or instruments" }));
        return;
      }

      // Tear down existing ticker before creating a new one
      if (state.ticker) {
        try { state.ticker.disconnect(); } catch { /* ignore */ }
        state.ticker = null;
      }

      const ticker = new KiteTicker({ api_key, access_token: token });
      state.ticker = ticker;

      ticker.connect();

      ticker.on("connect", () => {
        console.log(`[bridge] KiteTicker connected — ${instruments.length} instrument(s)`);
        const tickerMode =
          mode === "ltp"   ? ticker.modeLTP   :
          mode === "quote" ? ticker.modeQuote :
                             ticker.modeFull;
        ticker.subscribe(instruments);
        ticker.setMode(tickerMode, instruments);
        ws.send(JSON.stringify({ type: "connected", instruments }));
      });

      ticker.on("ticks", (ticks: TickerTick[]) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          type: "ticks",
          data: ticks.map(t => ({
            instrument_token: t.instrument_token,
            last_price:       t.last_price,
            volume:           t.volume          ?? 0,
            oi:               t.oi              ?? 0,
            average_price:    t.average_price   ?? 0,
            last_quantity:    t.last_quantity   ?? 0,
            ohlc:             t.ohlc,
            // Convert Date → ms timestamp for JSON serialisation
            timestamp: t.timestamp instanceof Date
              ? t.timestamp.getTime()
              : Date.now(),
          })),
        }));
      });

      ticker.on("disconnect", (err: Error) => {
        console.log(`[bridge] KiteTicker disconnected: ${err?.message ?? "unknown"}`);
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "disconnected", message: err?.message }));
      });

      ticker.on("error", (err: Error) => {
        console.error(`[bridge] KiteTicker error: ${err?.message}`);
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "error", error: err?.message }));
      });

      ticker.on("reconnect", (retries: number, interval: number) => {
        console.log(`[bridge] reconnecting… attempt ${retries}, interval ${interval}s`);
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "reconnecting", retries, interval }));
      });

      ticker.on("noreconnect", () => {
        console.error("[bridge] KiteTicker gave up reconnecting");
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "noreconnect" }));
      });

      ticker.on("order_update", (order: unknown) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "order_update", data: order }));
      });
    }

    if (msg.type === "unsubscribe") {
      if (state.ticker && msg.instruments?.length)
        state.ticker.unsubscribe(msg.instruments);
    }
  });

  ws.on("close", () => {
    const state = clients.get(ws);
    if (state?.ticker) {
      try { state.ticker.disconnect(); } catch { /* ignore */ }
    }
    clients.delete(ws);
    console.log(`[bridge] client disconnected (total: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error(`[bridge] ws error: ${err.message}`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`FAAX KiteTicker Bridge  →  port ${PORT}`);
  console.log(SECRET
    ? "[bridge] secret auth ENABLED"
    : "[bridge] WARNING: no BRIDGE_SECRET set — open access");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[bridge] SIGTERM — shutting down");
  clients.forEach((state, ws) => {
    if (state.ticker) { try { state.ticker.disconnect(); } catch { /* ignore */ } }
    ws.close();
  });
  httpServer.close(() => process.exit(0));
});
