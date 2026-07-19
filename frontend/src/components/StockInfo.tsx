import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { num } from "../format";
import type { Financial, NewsItem, Opinion } from "../types";

// 선택 종목 변경 시 fetcher를 호출해 결과/로딩 상태를 관리하는 공통 훅
function useSymbolData<T>(fetcher: (symbol: string) => Promise<T[]>): {
  rows: T[];
  loading: boolean;
} {
  const selected = useStore((s) => s.selected);
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoading(true);
    setRows([]);
    fetcher(selected)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  return { rows, loading };
}

// ---- 재무비율 ----
export function Financials() {
  const { rows, loading } = useSymbolData<Financial>(api.financials);
  if (loading && !rows.length) return <div className="si-empty">불러오는 중…</div>;
  if (!rows.length) return <div className="si-empty">재무 데이터 없음</div>;
  return (
    <div className="stock-info">
      <div className="si-fin">
        <div className="si-fin-row si-fin-head">
          <span>결산</span>
          <span className="ta-r">ROE</span>
          <span className="ta-r">부채비율</span>
          <span className="ta-r">EPS</span>
          <span className="ta-r">BPS</span>
        </div>
        {rows.map((f) => (
          <div className="si-fin-row" key={f.period}>
            <span>{fmtPeriod(f.period)}</span>
            <span className={`ta-r mono ${signTone(f.roe)}`}>{pctv(f.roe)}</span>
            <span className="ta-r mono">{pctv(f.debt_ratio)}</span>
            <span className={`ta-r mono ${signTone(f.eps)}`}>{num(f.eps)}</span>
            <span className="ta-r mono">{num(f.bps)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- 투자의견 ----
export function Opinions() {
  const { rows, loading } = useSymbolData<Opinion>(api.opinions);
  if (loading && !rows.length) return <div className="si-empty">불러오는 중…</div>;
  if (!rows.length) return <div className="si-empty">투자의견 없음</div>;
  return (
    <div className="stock-info">
      {rows.map((o, i) => (
        <div className="si-op" key={`${o.date}-${o.member}-${i}`}>
          <span className="si-op-date mono">{fmtDate(o.date)}</span>
          <span className="si-op-member">{o.member}</span>
          <span className={`si-op-opinion ${opTone(o.opinion)}`}>{o.opinion}</span>
          <span className="si-op-goal mono">{o.goal_price ? num(o.goal_price) : "-"}</span>
        </div>
      ))}
    </div>
  );
}

// ---- 뉴스 ----
export function StockNews() {
  const { rows, loading } = useSymbolData<NewsItem>(api.news);
  if (loading && !rows.length) return <div className="si-empty">불러오는 중…</div>;
  if (!rows.length) return <div className="si-empty">뉴스 없음</div>;
  return (
    <div className="stock-info">
      {rows.map((n, i) => (
        <div className="si-news" key={`${n.date}-${i}`}>
          <span className="si-news-meta mono">{fmtDate(n.date)}</span>
          <span className="si-news-title">{n.title}</span>
          {n.source && <span className="si-news-src">{n.source}</span>}
        </div>
      ))}
    </div>
  );
}

const fmtPeriod = (p: string | null): string =>
  p && p.length >= 6 ? `${p.slice(2, 4)}.${p.slice(4, 6)}` : p ?? "-";
const fmtDate = (d: string | null): string =>
  d && d.length >= 8 ? `${d.slice(4, 6)}/${d.slice(6, 8)}` : d ?? "-";
const pctv = (v: number | null): string => (v == null ? "-" : `${v.toFixed(1)}%`);
const signTone = (v: number | null): string => (v == null || v === 0 ? "" : v > 0 ? "up" : "down");
const opTone = (op: string | null): string => {
  if (!op) return "flat";
  const s = op.toLowerCase();
  if (s.includes("매수") || s.includes("비중확대") || s.includes("buy") || s.includes("outperform"))
    return "up";
  if (s.includes("매도") || s.includes("비중축소") || s.includes("sell") || s.includes("underperform"))
    return "down";
  return "flat";
};
