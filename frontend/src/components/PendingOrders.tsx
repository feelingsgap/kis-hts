import { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { name, num, snapToTick, tickSize } from "../format";
import type { OrdDvsn, PendingOrder } from "../types";
import { ConfirmDialog } from "./OrderConfirm";

// 미체결 탭 본문 (외곽 박스/타이틀은 OrdersPanel이 제공). 취소(확인+부분) + 정정(인라인) 지원.
export function PendingOrders() {
  const pending = useStore((s) => s.pending);
  const refreshAccount = useStore((s) => s.refreshAccount);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<PendingOrder | null>(null);
  const [cancelQty, setCancelQty] = useState<number>(0);

  const openCancel = (o: PendingOrder) => {
    setCancelling(o);
    setCancelQty(o.cancelable_qty ?? 0);
  };

  const doCancel = async () => {
    if (!cancelling) return;
    const { org_no, order_no, cancelable_qty } = cancelling;
    // 잔량 전체면 0(전량취소), 아니면 부분취소 수량 전달
    const q = cancelQty >= (cancelable_qty ?? 0) ? 0 : Math.max(1, cancelQty);
    setBusy(order_no);
    try {
      await api.cancelOrder(org_no, order_no, q);
      setCancelling(null);
      await refreshAccount();
    } catch {
      /* 실패 시 목록 유지 */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pd-table">
      <div className="pd-head">
        <span>종목</span>
        <span>구분</span>
        <span className="ta-r">주문/잔량</span>
        <span className="ta-r">가격</span>
        <span className="ta-c">주문정정</span>
      </div>
      {pending.length === 0 ? (
        <div className="pd-empty">미체결 주문 없음</div>
      ) : (
        pending.map((o) => (
          <div key={o.order_no}>
            <div className="pd-row">
              <span className="pd-name">
                <b>{o.name || name(o.symbol)}</b>
                <em>{o.symbol}</em>
              </span>
              <span className={o.side === "buy" ? "up" : "down"}>
                {o.side === "buy" ? "매수" : "매도"}
              </span>
              <span className="ta-r mono">
                {num(o.qty)}/{num(o.cancelable_qty)}
              </span>
              <span className="ta-r mono">{num(o.price)}</span>
              <span className="pd-actions">
                <button
                  className="pd-btn revise"
                  onClick={() => setEditing(editing === o.order_no ? null : o.order_no)}
                >
                  정정
                </button>
                <button
                  className="pd-btn cancel"
                  disabled={busy === o.order_no}
                  onClick={() => openCancel(o)}
                >
                  {busy === o.order_no ? "…" : "취소"}
                </button>
              </span>
            </div>
            {editing === o.order_no && (
              <ReviseRow
                order={o}
                onDone={async () => {
                  setEditing(null);
                  await refreshAccount();
                }}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        ))
      )}

      {cancelling && (
        <ConfirmDialog
          title="주문 취소"
          rows={[
            { label: "종목", value: `${cancelling.name || name(cancelling.symbol)} (${cancelling.symbol})` },
            {
              label: "구분",
              value: cancelling.side === "buy" ? "매수" : "매도",
              tone: cancelling.side === "buy" ? "up" : "down",
            },
            { label: "가격", value: `${num(cancelling.price)}원` },
            { label: "잔량", value: `${num(cancelling.cancelable_qty)}주` },
          ]}
          extra={
            <label className="modal-field">
              <span>취소수량</span>
              <input
                className="mono"
                type="number"
                min={1}
                max={cancelling.cancelable_qty ?? 1}
                value={cancelQty}
                onChange={(e) =>
                  setCancelQty(
                    Math.min(cancelling.cancelable_qty ?? 1, Math.max(1, +e.target.value || 1)),
                  )
                }
              />
              <em>{cancelQty >= (cancelling.cancelable_qty ?? 0) ? "전량취소" : "부분취소"}</em>
            </label>
          }
          confirmLabel="취소 확정"
          tone="neutral"
          busy={busy === cancelling.order_no}
          onConfirm={doCancel}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}

function ReviseRow({
  order,
  onDone,
  onCancel,
}: {
  order: PendingOrder;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [ordDvsn, setOrdDvsn] = useState<OrdDvsn>("00");
  const [price, setPrice] = useState<number>(order.price ?? 0);
  const [qty, setQty] = useState<number>(order.cancelable_qty ?? order.qty ?? 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const step = (d: number) => {
    const base = snapToTick(price || 0);
    setPrice(Math.max(0, base + d * tickSize(base)));
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.reviseOrder({
        org_no: order.org_no,
        order_no: order.order_no,
        qty: Math.max(1, qty),
        price: ordDvsn === "01" ? 0 : snapToTick(price || 0),
        ord_dvsn: ordDvsn,
      });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "정정 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pd-edit">
      <label className="pd-edit-field">
        <span>유형</span>
        <div className="op-seg sm">
          <button className={ordDvsn === "00" ? "on" : ""} onClick={() => setOrdDvsn("00")}>
            지정가
          </button>
          <button className={ordDvsn === "01" ? "on" : ""} onClick={() => setOrdDvsn("01")}>
            시장가
          </button>
        </div>
      </label>
      <label className="pd-edit-field">
        <span>가격</span>
        <div className="pd-stepper">
          <button onClick={() => step(-1)} disabled={ordDvsn === "01"}>
            −
          </button>
          <input
            className="mono"
            type="number"
            value={ordDvsn === "01" ? "" : price || ""}
            placeholder={ordDvsn === "01" ? "시장가" : ""}
            disabled={ordDvsn === "01"}
            onChange={(e) => setPrice(e.target.value ? +e.target.value : 0)}
          />
          <button onClick={() => step(1)} disabled={ordDvsn === "01"}>
            +
          </button>
        </div>
      </label>
      <label className="pd-edit-field">
        <span>수량</span>
        <input
          className="mono"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, +e.target.value || 1))}
        />
      </label>
      <button className="pd-btn revise on" disabled={busy} onClick={submit}>
        {busy ? "…" : "정정확정"}
      </button>
      <button className="pd-btn" onClick={onCancel}>
        닫기
      </button>
      {err && <div className="pd-edit-err">{err}</div>}
    </div>
  );
}
