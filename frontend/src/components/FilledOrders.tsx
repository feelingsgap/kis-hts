import { useEffect, useState } from "react";
import { api } from "../api";
import { name, num } from "../format";
import type { FilledOrder } from "../types";

// 체결내역 탭 본문 (외곽 박스/타이틀은 OrdersPanel이 제공)
export function FilledOrders({ active }: { active: boolean }) {
  const [rows, setRows] = useState<FilledOrder[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .filled()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  // 탭이 활성화될 때 조회
  useEffect(() => {
    if (active) load();
  }, [active]);

  return (
    <div className="pd-table">
      <div className="fl-head">
        <span>종목</span>
        <span>구분</span>
        <span className="ta-r">체결수량</span>
        <span className="ta-r">체결가</span>
        <span className="ta-r">시각</span>
      </div>
      {loading && rows.length === 0 ? (
        <div className="pd-empty">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="pd-empty">체결내역 없음</div>
      ) : (
        rows.map((o) => {
          // 시장가(price=0)는 평균체결가 표시
          const shown = o.price && o.price > 0 ? o.price : o.avg_price;
          return (
            <div key={o.order_no} className="fl-row">
              <span className="pd-name">
                <b>{o.name || name(o.symbol)}</b>
                <em>{o.symbol}</em>
              </span>
              <span className={o.side === "buy" ? "up" : "down"}>
                {o.side === "buy" ? "매수" : "매도"}
              </span>
              <span className="ta-r mono">{num(o.filled_qty ?? o.qty)}</span>
              <span className="ta-r mono">{num(shown)}</span>
              <span className="ta-r mono fl-time">{fmtTime(o.time)}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

// HHMMSS → HH:MM:SS
function fmtTime(t: string): string {
  if (!t || t.length < 6) return t ?? "-";
  return `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
}
