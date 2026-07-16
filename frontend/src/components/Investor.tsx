import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { dir, name, signed } from "../format";
import type { InvestorRow } from "../types";

// 투자자 탭 본문: 외국인/기관/개인 순매수 (외곽 박스/타이틀은 AccountPanel이 제공)
export function Investor() {
  const selected = useStore((s) => s.selected);
  const [rows, setRows] = useState<InvestorRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoading(true);
    api
      .investor(selected)
      .then((res) => alive && setRows(res.recent ?? []))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [selected]);

  return (
    <>
      <div className="inv-cap">
        {selected ? `${name(selected)} 순매수 (수량, 최근순)` : "종목 선택"}
      </div>
      <div className="inv-table">
        <div className="inv-head">
          <span>일자</span>
          <span className="ta-r">외국인</span>
          <span className="ta-r">기관</span>
          <span className="ta-r">개인</span>
        </div>
        {loading && rows.length === 0 ? (
          <div className="bt-empty">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="bt-empty">데이터 없음</div>
        ) : (
          rows.map((r) => (
            <div key={r.date} className="inv-row">
              <span className="mono inv-date">{fmtDate(r.date)}</span>
              <span className={`ta-r mono ${dir(r.foreign)}`}>{signed(r.foreign)}</span>
              <span className={`ta-r mono ${dir(r.institution)}`}>{signed(r.institution)}</span>
              <span className={`ta-r mono ${dir(r.individual)}`}>{signed(r.individual)}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// YYYYMMDD → MM/DD
function fmtDate(d: string): string {
  if (!d || d.length < 8) return d ?? "-";
  return `${d.slice(4, 6)}/${d.slice(6, 8)}`;
}
