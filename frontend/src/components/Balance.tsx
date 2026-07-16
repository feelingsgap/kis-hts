import { useStore } from "../store";
import { dir, name, num, pct, signed } from "../format";

// 잔고 탭 본문 (외곽 박스/타이틀은 AccountPanel이 제공)
export function Balance() {
  const balance = useStore((s) => s.balance);
  const select = useStore((s) => s.select);
  const s = balance?.summary;
  const holdings = balance?.holdings ?? [];

  return (
    <>
      <div className="bal-summary">
        <Stat label="예수금(D+2)" value={num(s?.deposit_d2)} />
        <Stat label="총평가금액" value={num(s?.eval_total)} />
        <Stat label="매입금액" value={num(s?.purchase_total)} />
        <Stat label="평가손익" value={signed(s?.pnl_total)} cls={dir(s?.pnl_total)} />
        <Stat
          label="실현손익*"
          value={signed(s?.realized_pnl)}
          cls={dir(s?.realized_pnl)}
          title="당일 실현손익 (수수료 제외 근사치)"
        />
        <Stat label="순자산" value={num(s?.net_asset)} />
      </div>

      <div className="bal-table">
        <div className="bt-head">
          <span>종목</span>
          <span className="ta-r">보유</span>
          <span className="ta-r">평균가</span>
          <span className="ta-r">현재가</span>
          <span className="ta-r">평가손익</span>
          <span className="ta-r">수익률</span>
        </div>
        {holdings.length === 0 ? (
          <div className="bt-empty">보유 종목 없음</div>
        ) : (
          holdings.map((h) => {
            const d = dir(h.pnl);
            return (
              <div key={h.symbol} className="bt-row" onClick={() => select(h.symbol)}>
                <span className="bt-name">
                  <b>{h.name || name(h.symbol)}</b>
                  <em>{h.symbol}</em>
                </span>
                <span className="ta-r mono">{num(h.qty)}</span>
                <span className="ta-r mono">{num(h.avg_price)}</span>
                <span className="ta-r mono">{num(h.price)}</span>
                <span className={`ta-r mono ${d}`}>{signed(h.pnl)}</span>
                <span className={`ta-r mono ${d}`}>{pct(h.pnl_rate)}</span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  cls,
  title,
}: {
  label: string;
  value: string;
  cls?: string;
  title?: string;
}) {
  return (
    <div className="bal-stat" title={title}>
      <span className="bs-lbl">{label}</span>
      <span className={`bs-val mono ${cls ?? ""}`}>{value}</span>
    </div>
  );
}
