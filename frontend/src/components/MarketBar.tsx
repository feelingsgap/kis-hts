import { useEffect, useState } from "react";
import { api } from "../api";
import { dir, pct } from "../format";
import type { IndexRow } from "../types";

// 지수는 소수 2자리 (예: 6,820.60)
const idx = (v: number | null): string =>
  v == null ? "-" : v.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const idxSigned = (v: number | null): string =>
  v == null ? "-" : (v > 0 ? "+" : "") + idx(v);

// 상단 코스피/코스닥 지수 티커. 10초 폴링(장중 갱신, 장외 정적).
export function MarketBar() {
  const [rows, setRows] = useState<IndexRow[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .marketIndex()
        .then((r) => alive && setRows(r))
        .catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!rows.length) return null;

  return (
    <div className="market-bar">
      {rows.map((r) => {
        const d = dir(r.change);
        return (
          <div className="mkt-item" key={r.code}>
            <span className="mkt-name">{r.name}</span>
            <span className={`mkt-val mono ${d}`}>{idx(r.value)}</span>
            <span className={`mkt-chg mono ${d}`}>
              {idxSigned(r.change)} ({pct(r.change_rate)})
            </span>
          </div>
        );
      })}
    </div>
  );
}
