// 백엔드 REST/WS 클라이언트
import type {
  BalanceResp,
  ChartResp,
  FilledOrder,
  FluctRankRow,
  InvestorResp,
  OrderBook,
  PendingOrder,
  PsblOrder,
  Quote,
  SearchResult,
  VolumeRankRow,
  WatchlistResp,
  WsMessage,
} from "./types";

const BASE = "http://127.0.0.1:8787";
const WS_URL = "ws://127.0.0.1:8787/ws";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

async function delJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? `${res.status} ${path}`);
  return data as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { detail?: string }).detail ?? `${res.status} ${path}`);
  }
  return data as T;
}

export const api = {
  health: () => getJson<{ ok: boolean; env: string; svr: string }>("/health"),
  watchlist: () => getJson<WatchlistResp>("/api/watchlist"),
  addWatch: (symbol: string) =>
    postJson<{ ok: boolean }>("/api/watchlist", { symbol }),
  removeWatch: (symbol: string) =>
    delJson<{ ok: boolean }>(`/api/watchlist/${symbol}`),
  reorderWatch: (symbols: string[]) =>
    postJson<{ symbols: string[] }>("/api/watchlist/reorder", { symbols }),
  search: (q: string) =>
    getJson<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  quote: (symbol: string) => getJson<Quote>(`/api/quote/${symbol}`),
  orderbook: (symbol: string) => getJson<OrderBook>(`/api/orderbook/${symbol}`),
  chartDaily: (symbol: string, period: "D" | "W" | "M") =>
    getJson<ChartResp>(`/api/chart/${symbol}/daily?period=${period}`),
  chartMinute: (symbol: string) => getJson<ChartResp>(`/api/chart/${symbol}/minute`),

  // P3: 잔고/주문
  balance: () => getJson<BalanceResp>("/api/balance"),
  psblOrder: (symbol: string, price: number, ordDvsn: "00" | "01") =>
    getJson<PsblOrder>(`/api/psbl-order/${symbol}?price=${price}&ord_dvsn=${ordDvsn}`),
  pending: () => getJson<PendingOrder[]>("/api/orders/pending"),
  filled: () => getJson<FilledOrder[]>("/api/orders/filled"),
  placeOrder: (body: {
    side: "buy" | "sell";
    symbol: string;
    qty: number;
    price: number;
    ord_dvsn: "00" | "01";
  }) => postJson<{ ok: boolean; order_no?: string }>("/api/order", body),
  cancelOrder: (org_no: string, order_no: string) =>
    postJson<{ ok: boolean }>("/api/order/cancel", { org_no, order_no, qty: 0 }),
  reviseOrder: (body: {
    org_no: string;
    order_no: string;
    qty: number;
    price: number;
    ord_dvsn: "00" | "01";
  }) => postJson<{ ok: boolean; order_no?: string }>("/api/order/revise", body),

  // 순위 / 투자자
  rankingVolume: () => getJson<VolumeRankRow[]>("/api/ranking/volume"),
  rankingFluctuation: (type: "up" | "down") =>
    getJson<FluctRankRow[]>(`/api/ranking/fluctuation?type=${type}`),
  investor: (symbol: string) => getJson<InvestorResp>(`/api/investor/${symbol}`),
};

/** 로컬 WS에 연결하고 메시지를 콜백으로 전달. 끊기면 자동 재연결. */
export function connectWs(
  onMessage: (msg: WsMessage) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => onStatus?.(true);
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data) as WsMessage);
      } catch {
        /* 잘못된 프레임 무시 */
      }
    };
    ws.onclose = () => {
      onStatus?.(false);
      if (!closed) retry = setTimeout(open, 1500);
    };
    ws.onerror = () => ws?.close();
  };
  open();

  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    ws?.close();
  };
}
