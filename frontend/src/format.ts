// 포맷/방향 유틸 (한국 관행: 상승 red, 하락 blue)
import { useStore } from "./store";

// 데모용 종목명 폴백 매핑 (1차 소스는 백엔드가 내려주는 store.names)
export const NAMES: Record<string, string> = {
  "005930": "삼성전자",
  "000660": "SK하이닉스",
  "035420": "NAVER",
};

// 1순위: 백엔드 names 맵(store) → 2순위: 로컬 NAMES → 3순위: 코드
export const name = (sym: string): string =>
  useStore.getState().names[sym] ?? NAMES[sym] ?? sym;

export const num = (v: number | null | undefined): string =>
  v === null || v === undefined ? "-" : v.toLocaleString("ko-KR");

export const signed = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return "-";
  const s = v > 0 ? "+" : "";
  return s + v.toLocaleString("ko-KR");
};

export const pct = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return "-";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(2)}%`;
};

// 등락 방향 → 색상 클래스
export type Dir = "up" | "down" | "flat";
export const dir = (change: number | null | undefined): Dir =>
  change === null || change === undefined || change === 0 ? "flat" : change > 0 ? "up" : "down";

// KRX 호가단위 (2023년 개정 기준)
export function tickSize(price: number): number {
  if (price < 2000) return 1;
  if (price < 5000) return 5;
  if (price < 20000) return 10;
  if (price < 50000) return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

// 가격을 유효한 호가단위로 스냅
export function snapToTick(price: number): number {
  const t = tickSize(price);
  return Math.round(price / t) * t;
}
