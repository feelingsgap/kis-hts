import { api } from "../api";
import { useStore } from "../store";
import { useCached } from "../cache";
import { num } from "../format";
import type { Financial, NewsItem, Opinion } from "../types";

// 선택 종목 데이터 캐시(종목별). 같은 종목이면 탭 재진입 시 재조회 안 함.
function useSymbolData<T>(
  kind: string,
  fetcher: (symbol: string) => Promise<T[]>,
  signal: number,
): { rows: T[]; loading: boolean } {
  const selected = useStore((s) => s.selected);
  const { data, loading } = useCached<T[]>(
    selected ? `${kind}:${selected}` : null,
    () => fetcher(selected!),
    0,
    signal,
  );
  return { rows: data ?? [], loading };
}

// ---- 재무비율 ----
export function Financials({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const { rows, loading } = useSymbolData<Financial>("financials", api.financials, refreshSignal);
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
export function Opinions({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const { rows, loading } = useSymbolData<Opinion>("opinions", api.opinions, refreshSignal);
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
export function StockNews({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const { rows, loading } = useSymbolData<NewsItem>("news", api.news, refreshSignal);
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
