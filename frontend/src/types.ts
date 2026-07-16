// 백엔드(FastAPI) 응답/실시간 메시지 타입

export interface Quote {
  symbol: string;
  price: number | null;
  change: number | null;
  change_rate: number | null;
  sign: string | null; // 1상한 2상승 3보합 4하한 5하락
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  value: number | null;
  upper: number | null; // 상한가
  lower: number | null; // 하한가
}

export interface Level {
  price: number | null;
  qty: number | null;
}

export interface OrderBook {
  symbol: string;
  asks: Level[]; // 매도호가 1~10
  bids: Level[]; // 매수호가 1~10
  total_ask_qty: number | null;
  total_bid_qty: number | null;
  exp_price?: number | null; // 예상체결가
  exp_qty?: number | null; // 예상체결수량
  exp_change_rate?: number | null; // 예상 등락률
  time?: string;
}

// 로컬 WS(/ws) 브로드캐스트 메시지
export interface TickMsg {
  type: "tick";
  symbol: string;
  time: string;
  price: number | null;
  change: number | null;
  change_rate: number | null;
  sign: string | null;
  cntg_vol: number | null;
  acml_vol: number | null;
}

export interface OrderBookMsg extends OrderBook {
  type: "orderbook";
}

// 실시간 체결통보
export interface FillMsg {
  type: "fill";
  symbol: string;
  name: string;
  side: "buy" | "sell";
  qty: number | null;
  price: number | null;
  time: string;
  order_no: string;
}

export type WsMessage = TickMsg | OrderBookMsg | FillMsg;

export interface Candle {
  date: string; // YYYYMMDD
  time?: string; // HHMMSS (분봉만)
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface ChartResp {
  symbol: string;
  period: string;
  candles: Candle[];
}

export type ChartPeriod = "M1" | "D" | "W" | "M";

// ---- P3: 잔고/주문 ----
export interface BalanceSummary {
  deposit: number | null;
  deposit_d2: number | null;
  eval_total: number | null;
  purchase_total: number | null;
  securities_eval: number | null;
  pnl_total: number | null;
  net_asset: number | null;
  realized_pnl?: number | null; // 당일 실현손익 (수수료 제외 근사치, null 가능)
}

export interface Holding {
  symbol: string;
  name: string;
  qty: number | null;
  orderable_qty: number | null;
  avg_price: number | null;
  price: number | null;
  eval_amount: number | null;
  pnl: number | null;
  pnl_rate: number | null;
}

export interface BalanceResp {
  summary: BalanceSummary;
  holdings: Holding[];
}

export interface PsblOrder {
  symbol: string;
  orderable_cash: number | null;
  buyable_amount: number | null;
  buyable_qty: number | null;
  max_buy_amount: number | null;
  max_buy_qty: number | null;
}

export interface PendingOrder {
  order_no: string;
  org_no: string;
  symbol: string;
  name: string;
  side: "buy" | "sell";
  qty: number | null;
  filled_qty: number | null;
  cancelable_qty: number | null;
  price: number | null;
}

export interface OrderResult {
  ok: boolean;
  order_no?: string;
  org_no?: string;
  time?: string;
  error?: string;
}

export type Side = "buy" | "sell";
export type OrdDvsn = "00" | "01"; // 00 지정가 / 01 시장가

// 체결내역
export interface FilledOrder {
  order_no: string;
  symbol: string;
  name: string;
  side: "buy" | "sell";
  qty: number | null;
  filled_qty: number | null;
  price: number | null; // 시장가는 0 → avg_price 사용
  avg_price: number | null;
  time: string;
}

// 종목검색
export interface SearchResult {
  symbol: string;
  name: string;
  market: string;
}

// 순위 (거래량)
export interface VolumeRankRow {
  rank: number;
  symbol: string;
  name: string;
  price: number | null;
  change_rate: number | null;
  volume: number | null;
  value: number | null;
}

// 순위 (등락률)
export interface FluctRankRow {
  rank: number;
  symbol: string;
  name: string;
  price: number | null;
  change_rate: number | null;
}

// 투자자 순매수 (외국인/기관/개인)
export interface InvestorRow {
  date: string;
  foreign: number | null;
  institution: number | null;
  individual: number | null;
  close: number | null;
}

export interface InvestorResp {
  recent: InvestorRow[];
}

// 관심종목 응답
export interface WatchlistResp {
  symbols: string[];
  names: Record<string, string>;
}
