// 실시간 시세 + 계좌 상태 (zustand)
import { create } from "zustand";
import { api } from "./api";
import { loadPref, savePref } from "./persist";
import type {
  BalanceResp,
  OrderBook,
  PendingOrder,
  PriceAlert,
  Quote,
  Side,
  WsMessage,
} from "./types";

export interface Toast {
  id: number;
  text: string;
  kind: "buy" | "sell" | "info";
}

interface State {
  symbols: string[];
  names: Record<string, string>; // 종목코드 → 종목명 (백엔드 우선 소스)
  selected: string | null;
  quotes: Record<string, Quote>;
  orderbooks: Record<string, OrderBook>;
  wsConnected: boolean;

  // P3
  balance: BalanceResp | null;
  pending: PendingOrder[];
  orderDraft: { side: Side; price: number | null };

  // 체결통보 토스트
  toasts: Toast[];

  // 가격 알림
  alerts: PriceAlert[];

  setWatchlist: (symbols: string[], names?: Record<string, string>) => void;
  mergeNames: (names: Record<string, string>) => void;
  select: (s: string) => void;
  selectAdjacent: (delta: number) => void;
  setQuote: (q: Quote) => void;
  setOrderBook: (o: OrderBook) => void;
  applyWs: (m: WsMessage) => void;
  setWsConnected: (c: boolean) => void;
  setOrderDraft: (d: Partial<{ side: Side; price: number | null }>) => void;
  refreshAccount: () => Promise<void>;
  refreshWatchlist: () => Promise<void>;
  reorderWatchlist: (order: string[]) => void;
  pushToast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  addAlert: (symbol: string, price: number, dir: PriceAlert["dir"]) => void;
  removeAlert: (id: number) => void;
}

let toastSeq = 0;
const initialAlerts = loadPref<PriceAlert[]>("alerts", []);
let alertSeq = initialAlerts.reduce((m, a) => Math.max(m, a.id), 0);

export const useStore = create<State>((set, get) => ({
  symbols: [],
  names: {},
  selected: loadPref<string | null>("selected", null),
  quotes: {},
  orderbooks: {},
  wsConnected: false,
  balance: null,
  pending: [],
  orderDraft: { side: loadPref<Side>("order.side", "buy"), price: null },
  toasts: [],
  alerts: initialAlerts,

  setWatchlist: (symbols, names) =>
    set((st) => ({
      symbols,
      names: names ? { ...st.names, ...names } : st.names,
      // 저장된 선택 종목이 관심목록에 있으면 유지, 아니면 첫 종목
      selected: st.selected && symbols.includes(st.selected) ? st.selected : symbols[0] ?? null,
    })),
  mergeNames: (names) => set((st) => ({ names: { ...st.names, ...names } })),
  select: (s) => {
    savePref("selected", s);
    set({ selected: s });
  },
  selectAdjacent: (delta) => {
    const { symbols, selected } = get();
    if (!symbols.length) return;
    const i = selected ? symbols.indexOf(selected) : -1;
    const next = symbols[(i + delta + symbols.length) % symbols.length];
    if (next) get().select(next);
  },
  setQuote: (q) => set((st) => ({ quotes: { ...st.quotes, [q.symbol]: q } })),
  setOrderBook: (o) => set((st) => ({ orderbooks: { ...st.orderbooks, [o.symbol]: o } })),
  setWsConnected: (c) => set({ wsConnected: c }),
  setOrderDraft: (d) =>
    set((st) => {
      const next = { ...st.orderDraft, ...d };
      if (d.side !== undefined) savePref("order.side", next.side);
      return { orderDraft: next };
    }),

  refreshAccount: async () => {
    const [balance, pending] = await Promise.all([
      api.balance().catch(() => null),
      api.pending().catch(() => []),
    ]);
    set({ balance, pending });
  },

  refreshWatchlist: async () => {
    const wl = await api.watchlist().catch(() => null);
    if (!wl) return;
    const have = get().quotes;
    set((st) => ({
      symbols: wl.symbols,
      names: { ...st.names, ...(wl.names ?? {}) },
      selected: st.selected && wl.symbols.includes(st.selected) ? st.selected : wl.symbols[0] ?? null,
    }));
    // 새로 추가된 종목 스냅샷 시세
    for (const sym of wl.symbols) {
      if (have[sym]) continue;
      api
        .quote(sym)
        .then((q) => get().setQuote(q))
        .catch(() => {});
    }
  },

  reorderWatchlist: (order) => {
    set({ symbols: order }); // 낙관적 갱신
    api.reorderWatch(order).catch(() => {});
  },

  pushToast: (text, kind = "info") =>
    set((st) => ({ toasts: [...st.toasts, { id: ++toastSeq, text, kind }] })),
  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),

  addAlert: (symbol, price, dir) => {
    set((st) => ({ alerts: [...st.alerts, { id: ++alertSeq, symbol, price, dir }] }));
    savePref("alerts", get().alerts);
  },
  removeAlert: (id) => {
    set((st) => ({ alerts: st.alerts.filter((a) => a.id !== id) }));
    savePref("alerts", get().alerts);
  },

  applyWs: (m) => {
    if (m.type === "fill") {
      const kind: Toast["kind"] = m.side === "buy" ? "buy" : "sell";
      const sideKr = m.side === "buy" ? "매수" : "매도";
      const nm = m.name || get().names[m.symbol] || m.symbol;
      const priceTxt = m.price != null ? m.price.toLocaleString("ko-KR") : "-";
      const qtyTxt = m.qty != null ? m.qty.toLocaleString("ko-KR") : "-";
      get().pushToast(`체결 · ${nm} ${sideKr} ${qtyTxt}주 @${priceTxt}`, kind);
      void get().refreshAccount();
      return;
    }
    if (m.type === "tick") {
      set((st) => {
        const prev = st.quotes[m.symbol];
        const q: Quote = {
          ...(prev ?? emptyQuote(m.symbol)),
          price: m.price,
          change: m.change,
          change_rate: m.change_rate,
          sign: m.sign,
          volume: m.acml_vol,
        };
        return { quotes: { ...st.quotes, [m.symbol]: q } };
      });
      checkAlerts(get, m.symbol, m.price);
      return;
    }
    // orderbook
    set((st) => {
      const { type: _t, ...ob } = m;
      void _t;
      return { orderbooks: { ...st.orderbooks, [m.symbol]: ob as OrderBook } };
    });
  },
}));

// 가격 알림 도달 검사: tick 가격이 목표를 넘으면 토스트 후 해당 알림 제거
function checkAlerts(get: () => State, symbol: string, price: number | null): void {
  if (price == null) return;
  const { alerts, names, pushToast, removeAlert } = get();
  const hit = alerts.filter(
    (a) => a.symbol === symbol && (a.dir === "above" ? price >= a.price : price <= a.price),
  );
  if (!hit.length) return;
  for (const a of hit) {
    const nm = names[a.symbol] || a.symbol;
    const arrow = a.dir === "above" ? "이상" : "이하";
    pushToast(
      `🔔 ${nm} ${a.price.toLocaleString("ko-KR")}원 ${arrow} 도달 (현재 ${price.toLocaleString("ko-KR")})`,
      "info",
    );
    removeAlert(a.id);
  }
}

function emptyQuote(symbol: string): Quote {
  return {
    symbol,
    price: null,
    change: null,
    change_rate: null,
    sign: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    value: null,
    upper: null,
    lower: null,
  };
}
