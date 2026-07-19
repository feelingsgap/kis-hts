import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { num } from "../format";
import type { StockInfoResp } from "../types";

// 정보 탭 본문: 재무비율 / 투자의견 / 뉴스 (외곽/타이틀은 AccountPanel)
export function StockInfo() {
  const selected = useStore((s) => s.selected);
  const [info, setInfo] = useState<StockInfoResp | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoading(true);
    setInfo(null);
    api
      .stockInfo(selected)
      .then((r) => alive && setInfo(r))
      .catch(() => alive && setInfo(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [selected]);

  if (loading && !info) return <div className="si-empty">불러오는 중…</div>;
  if (!info) return <div className="si-empty">정보 없음</div>;

  return (
    <div className="stock-info">
      <section className="si-sec">
        <h4>재무비율</h4>
        {info.financials.length === 0 ? (
          <div className="si-none">데이터 없음</div>
        ) : (
          <div className="si-fin">
            <div className="si-fin-row si-fin-head">
              <span>결산</span>
              <span className="ta-r">ROE</span>
              <span className="ta-r">부채비율</span>
              <span className="ta-r">EPS</span>
              <span className="ta-r">BPS</span>
            </div>
            {info.financials.map((f) => (
              <div className="si-fin-row" key={f.period}>
                <span>{fmtPeriod(f.period)}</span>
                <span className="ta-r mono">{pctv(f.roe)}</span>
                <span className="ta-r mono">{pctv(f.debt_ratio)}</span>
                <span className="ta-r mono">{num(f.eps)}</span>
                <span className="ta-r mono">{num(f.bps)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="si-sec">
        <h4>투자의견</h4>
        {info.opinions.length === 0 ? (
          <div className="si-none">데이터 없음</div>
        ) : (
          info.opinions.map((o, i) => (
            <div className="si-op" key={`${o.date}-${o.member}-${i}`}>
              <span className="si-op-date mono">{fmtDate(o.date)}</span>
              <span className="si-op-member">{o.member}</span>
              <span className={`si-op-opinion ${opTone(o.opinion)}`}>{o.opinion}</span>
              <span className="si-op-goal mono">{o.goal_price ? `${num(o.goal_price)}` : "-"}</span>
            </div>
          ))
        )}
      </section>

      <section className="si-sec">
        <h4>뉴스</h4>
        {info.news.length === 0 ? (
          <div className="si-none">데이터 없음</div>
        ) : (
          info.news.map((n, i) => (
            <div className="si-news" key={`${n.date}-${i}`}>
              <span className="si-news-meta mono">{fmtDate(n.date)}</span>
              <span className="si-news-title">{n.title}</span>
              {n.source && <span className="si-news-src">{n.source}</span>}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

const fmtPeriod = (p: string | null): string =>
  p && p.length >= 6 ? `${p.slice(2, 4)}.${p.slice(4, 6)}` : p ?? "-";
const fmtDate = (d: string | null): string =>
  d && d.length >= 8 ? `${d.slice(4, 6)}/${d.slice(6, 8)}` : d ?? "-";
const pctv = (v: number | null): string => (v == null ? "-" : `${v.toFixed(1)}%`);
const opTone = (op: string | null): string => {
  if (!op) return "flat";
  const s = op.toLowerCase();
  if (s.includes("매수") || s.includes("비중확대") || s.includes("buy") || s.includes("outperform"))
    return "up";
  if (s.includes("매도") || s.includes("비중축소") || s.includes("sell") || s.includes("underperform"))
    return "down";
  return "flat";
};
