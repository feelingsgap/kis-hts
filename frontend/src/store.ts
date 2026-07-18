// 실시간 시세 + 계좌 상태 (zustand)
import { create } from "zustand";
import { api } from "./api";
import { loadPref, savePref } from "./persist";
import type { BalanceResp, OrderBook, PendingOrder, Quote, Side, WsMessage } from "./types";

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

  setWatchlist: (symbols: string[], names?: Record<string, string>) => void;
  mergeNames: (names: Record<string, string>) => void;
  select: (s: string) => void;
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
}

let toastSeq = 0;

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
    set((st) => {
      if (m.type === "tick") {
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
      }
      // orderbook
      const { type: _t, ...ob } = m;
      void _t;
      return { orderbooks: { ...st.orderbooks, [m.symbol]: ob as OrderBook } };
    });
  },
}));

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
