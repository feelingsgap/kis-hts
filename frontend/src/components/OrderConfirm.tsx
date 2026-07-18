import { useEffect, type ReactNode } from "react";

export interface ConfirmRow {
  label: string;
  value: string;
  tone?: "up" | "down" | null; // 값 색상 (상승 red / 하락 blue)
  strong?: boolean;
}

// 발주/취소 등 되돌리기 어려운 주문 액션 전 확인 모달. 오발주 방지용.
// 네이티브 alert/confirm 대신 커스텀 모달(브라우저 자동화·접근성 안전).
export function ConfirmDialog({
  title,
  rows,
  extra,
  confirmLabel,
  tone,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  rows: ConfirmRow[];
  extra?: ReactNode;
  confirmLabel: string;
  tone: "buy" | "sell" | "neutral";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // Esc 닫기 / Enter 확정
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "Enter" && !busy) onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onConfirm, onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{title}</div>
        <div className="modal-rows">
          {rows.map((r) => (
            <div className="modal-row" key={r.label}>
              <span className="modal-label">{r.label}</span>
              <span className={`modal-value mono ${r.tone ?? ""} ${r.strong ? "strong" : ""}`}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
        {extra && <div className="modal-extra">{extra}</div>}
        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className={`modal-btn confirm ${tone}`} onClick={onConfirm} disabled={busy}>
            {busy ? "처리 중…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
