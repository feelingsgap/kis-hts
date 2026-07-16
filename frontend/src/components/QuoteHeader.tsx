import { useStore } from "../store";
import { dir, name, num, pct, signed } from "../format";

export function QuoteHeader({ symbol }: { symbol: string }) {
  const q = useStore((s) => s.quotes[symbol]);
  const d = dir(q?.change);

  return (
    <div className="quote-header">
      <div className="qh-top">
        <div className="qh-id">
          <h2>{name(symbol)}</h2>
          <span className="qh-code mono">{symbol}</span>
        </div>
        <div className={`qh-price mono ${d}`}>
          <span className="qh-cur">{num(q?.price)}</span>
          <span className="qh-chg">
            {signed(q?.change)} ({pct(q?.change_rate)})
          </span>
        </div>
      </div>
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
