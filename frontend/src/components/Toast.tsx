import { useEffect } from "react";
import { useStore } from "../store";
import type { Toast } from "../store";

// 체결통보 등 일시 토스트. 각 항목이 스스로 타임아웃 후 사라진다(외부 라이브러리 없음).
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast);
  useEffect(() => {
    const id = setTimeout(() => dismiss(toast.id), 4200);
    return () => clearTimeout(id);
  }, [toast.id, dismiss]);

  return (
    <div className={`toast ${toast.kind}`} onClick={() => dismiss(toast.id)}>
      <span className="toast-dot" />
      <span className="toast-text">{toast.text}</span>
    </div>
  );
}
