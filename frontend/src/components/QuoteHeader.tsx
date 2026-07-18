import { useState } from "react";
import { useStore } from "../store";
import { dir, name, num, pct, signed } from "../format";

export function QuoteHeader({ symbol }: { symbol: string }) {
  const q = useStore((s) => s.quotes[symbol]);
  // 셀렉터는 안정적 참조(s.alerts)만 반환하고 필터는 렌더 본문에서 (새 배열 반환 시 무한 렌더)
  const allAlerts = useStore((s) => s.alerts);
  const addAlert = useStore((s) => s.addAlert);
  const removeAlert = useStore((s) => s.removeAlert);
  const alerts = allAlerts.filter((a) => a.symbol === symbol);
  const d = dir(q?.change);

  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<number | "">("");

  const toggle = () => {
    setOpen((o) => {
      if (!o) setTarget(q?.price ?? "");
      return !o;
    });
  };
  const add = (dr: "above" | "below") => {
    if (typeof target === "number" && target > 0) {
      addAlert(symbol, target, dr);
      setTarget("");
    }
  };

  return (
    <div className="quote-header">
      <div className="qh-top">
        <div className="qh-id">
          <h2>{name(symbol)}</h2>
          <span className="qh-code mono">{symbol}</span>
        </div>
        <div className="qh-right">
          <div className={`qh-price mono ${d}`}>
            <span className="qh-cur">{num(q?.price)}</span>
            <span className="qh-chg">
              {signed(q?.change)} ({pct(q?.change_rate)})
            </span>
          </div>
          <button
            className={`qh-bell ${alerts.length ? "on" : ""}`}
            onClick={toggle}
            title="가격 알림"
          >
            🔔{alerts.length ? ` ${alerts.length}` : ""}
          </button>
        </div>
      </div>

      {open && (
        <div className="qh-alert">
          <input
            className="mono"
            type="number"
            placeholder="목표가"
            value={target}
            onChange={(e) => setTarget(e.target.value ? +e.target.value : "")}
          />
          <button className="up" onClick={() => add("above")}>
            이상 ↑
          </button>
          <button className="down" onClick={() => add("below")}>
            이하 ↓
          </button>
          <div className="qh-alert-list">
            {alerts.length === 0 ? (
              <span className="qh-alert-empty">등록된 알림 없음</span>
            ) : (
              alerts.map((a) => (
                <button
                  key={a.id}
                  className="qh-alert-chip"
                  onClick={() => removeAlert(a.id)}
                  title="클릭하여 삭제"
                >
                  {a.dir === "above" ? "↑" : "↓"} {num(a.price)} ×
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="qh-ohlc">
        <Field label="시가" value={num(q?.open)} />
        <Field label="고가" value={num(q?.high)} cls="up" />
        <Field label="저가" value={num(q?.low)} cls="down" />
        <Field label="거래량" value={num(q?.volume)} />
        <Field label="상한" value={num(q?.upper)} cls="up" />
        <Field label="하한" value={num(q?.lower)} cls="down" />
      </div>
    </div>
  );
}

function Field({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="qh-field">
      <span className="qh-lbl">{label}</span>
      <span className={`qh-val mono ${cls ?? ""}`}>{value}</span>
    </div>
  );
}
