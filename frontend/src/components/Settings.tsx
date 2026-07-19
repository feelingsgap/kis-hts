import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { useSettings } from "../settings";
import { num } from "../format";
import type { CredentialsIn, OrdDvsn, SettingsStatus } from "../types";

// 통합 설정 모달: 연결·계정(편집) / 주문 기본값 / 화면 / 알림.
export function Settings({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card settings-card"
        role="dialog"
        aria-modal="true"
        aria-label="설정"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <span className="modal-title">설정</span>
          <button className="settings-x" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="settings-body">
          <ConnectionSection />
          <OrderSection />
          <DisplaySection />
          <AlertSection />
          <ResetSection />
        </div>
      </div>
    </div>
  );
}

// ---- A. 연결·계정 (편집 가능) ----
function ConnectionSection() {
  const [st, setSt] = useState<SettingsStatus | null>(null);
  const [form, setForm] = useState<CredentialsIn>({});
  const [busy, setBusy] = useState<"" | "save" | "token">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    api
      .settingsStatus()
      .then(setSt)
      .catch(() => setMsg({ ok: false, text: "상태 조회 실패 (백엔드 확인)" }));
  };
  useEffect(load, []);

  const isProd = st?.env === "prod";

  const save = async () => {
    const body: CredentialsIn = {};
    for (const k of ["app_key", "app_secret", "account", "hts_id", "prod"] as const) {
      const v = (form[k] ?? "").trim();
      if (v) body[k] = v;
    }
    if (!Object.keys(body).length) {
      setMsg({ ok: false, text: "변경할 값을 입력하세요" });
      return;
    }
    setBusy("save");
    setMsg(null);
    try {
      setSt(await api.saveCredentials(body));
      setForm({});
      setMsg({ ok: true, text: "저장 후 재인증 완료" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "저장 실패" });
    } finally {
      setBusy("");
    }
  };

  const refreshToken = async () => {
    setBusy("token");
    setMsg(null);
    try {
      setSt(await api.refreshToken());
      setMsg({ ok: true, text: "토큰 재발급 완료" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "재발급 실패" });
    } finally {
      setBusy("");
    }
  };

  const set = (k: keyof CredentialsIn, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <section className="set-sec">
      <div className="set-sec-title">
        연결 · 계정
        {st && (
          <span className={`brand-env ${isProd ? "prod" : ""}`}>
            {isProd ? "실전투자" : "모의투자"}
          </span>
        )}
      </div>

      {/* 읽기 전용 상태 */}
      <div className="set-status">
        <StatRow label="계좌" value={st?.account ?? "-"} />
        <StatRow label="HTS ID" value={st?.hts_id ?? "-"} />
        <StatRow label="App Key" value={st?.app_key_masked ?? "-"} />
        <StatRow label="App Secret" value={st?.has_secret ? "설정됨" : "미설정"} />
        <StatRow label="토큰 만료" value={fmtExpiry(st?.token_valid_until)} />
      </div>

      {/* 자격증명 편집 (본인 KIS 키 입력) */}
      <div className="set-cred">
        <div className="set-cred-note">
          config/{st?.env ?? "vps"}/.env 에 저장됩니다(이 PC 로컬, git 제외). 시크릿은 저장만 되고
          화면에 다시 표시되지 않습니다. 빈 칸은 기존 값 유지.
        </div>
        <CredField
          label="App Key"
          placeholder={st?.app_key_masked ?? "미설정"}
          value={form.app_key ?? ""}
          onChange={(v) => set("app_key", v)}
        />
        <CredField
          label="App Secret"
          type="password"
          placeholder={st?.has_secret ? "설정됨 (변경 시 입력)" : "미설정"}
          value={form.app_secret ?? ""}
          onChange={(v) => set("app_secret", v)}
        />
        <CredField
          label="계좌번호"
          placeholder={st?.account ?? "8자리"}
          value={form.account ?? ""}
          onChange={(v) => set("account", v)}
        />
        <CredField
          label="HTS ID"
          placeholder={st?.hts_id ?? "미설정"}
          value={form.hts_id ?? ""}
          onChange={(v) => set("hts_id", v)}
        />
        <div className="set-cred-actions">
          <button className="set-btn" onClick={refreshToken} disabled={!!busy}>
            {busy === "token" ? "재발급 중…" : "토큰 재발급"}
          </button>
          <button className="set-btn primary" onClick={save} disabled={!!busy}>
            {busy === "save" ? "저장 중…" : "자격증명 저장"}
          </button>
        </div>
        {msg && <div className={`set-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
      </div>
      <div className="set-cred-note muted">
        투자환경(모의↔실전) 전환은 백엔드 재시작이 필요합니다(KIS_HTS_ENV).
      </div>
    </section>
  );
}

// ---- B. 주문 기본값 ----
function OrderSection() {
  const orderDefaultType = useSettings((s) => s.orderDefaultType);
  const confirmEnabled = useSettings((s) => s.confirmEnabled);
  const qtyPresets = useSettings((s) => s.qtyPresets);
  const set = useSettings((s) => s.set);

  const setPreset = (i: number, v: number) => {
    const next = qtyPresets.slice();
    next[i] = Math.max(1, Math.min(100, v || 1));
    set("qtyPresets", next);
  };

  return (
    <section className="set-sec">
      <div className="set-sec-title">주문 기본값</div>
      <div className="set-row">
        <span>기본 주문유형</span>
        <Seg<OrdDvsn>
          value={orderDefaultType}
          options={[
            { v: "00", label: "지정가" },
            { v: "01", label: "시장가" },
          ]}
          onChange={(v) => set("orderDefaultType", v)}
        />
      </div>
      <div className="set-row">
        <span>주문 확인창</span>
        <Toggle on={confirmEnabled} onChange={(v) => set("confirmEnabled", v)} />
      </div>
      <div className="set-row">
        <span>수량 프리셋(%)</span>
        <div className="set-presets">
          {qtyPresets.map((p, i) => (
            <input
              key={i}
              className="mono"
              type="number"
              min={1}
              max={100}
              value={p}
              onChange={(e) => setPreset(i, +e.target.value)}
            />
          ))}
        </div>
      </div>
      <div className="set-hint">실전투자에서는 확인창이 항상 표시됩니다(오발주 방지).</div>
    </section>
  );
}

// ---- C. 화면·표시 ----
function DisplaySection() {
  const colorScheme = useSettings((s) => s.colorScheme);
  const set = useSettings((s) => s.set);
  return (
    <section className="set-sec">
      <div className="set-sec-title">화면 · 표시</div>
      <div className="set-row">
        <span>등락 색상</span>
        <div className="set-scheme">
          <SchemeBtn
            active={colorScheme === "kr"}
            onClick={() => set("colorScheme", "kr")}
            up="#ff5b52"
            down="#5b9bff"
            label="한국식"
          />
          <SchemeBtn
            active={colorScheme === "global"}
            onClick={() => set("colorScheme", "global")}
            up="#22c55e"
            down="#ef4444"
            label="글로벌식"
          />
        </div>
      </div>
      <div className="set-hint">한국식: 상승 빨강/하락 파랑 · 글로벌식: 상승 초록/하락 빨강</div>
    </section>
  );
}

// ---- D. 알림 ----
function AlertSection() {
  const toastEnabled = useSettings((s) => s.toastEnabled);
  const soundEnabled = useSettings((s) => s.soundEnabled);
  const set = useSettings((s) => s.set);
  const alerts = useStore((s) => s.alerts);
  const names = useStore((s) => s.names);
  const removeAlert = useStore((s) => s.removeAlert);

  return (
    <section className="set-sec">
      <div className="set-sec-title">알림</div>
      <div className="set-row">
        <span>체결 토스트</span>
        <Toggle on={toastEnabled} onChange={(v) => set("toastEnabled", v)} />
      </div>
      <div className="set-row">
        <span>소리</span>
        <Toggle on={soundEnabled} onChange={(v) => set("soundEnabled", v)} />
      </div>
      <div className="set-alerts">
        <div className="set-alerts-head">가격 알림 ({alerts.length})</div>
        {alerts.length === 0 ? (
          <div className="set-empty">등록된 알림 없음</div>
        ) : (
          alerts.map((a) => (
            <div className="set-alert-row" key={a.id}>
              <span className="set-alert-name">
                <b>{names[a.symbol] || a.symbol}</b>
                <em>{a.symbol}</em>
              </span>
              <span className={`mono ${a.dir === "above" ? "up" : "down"}`}>
                {num(a.price)} {a.dir === "above" ? "이상↑" : "이하↓"}
              </span>
              <button className="set-alert-del" onClick={() => removeAlert(a.id)} aria-label="삭제">
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ---- 초기화 ----
function ResetSection() {
  const reset = useSettings((s) => s.reset);
  const [done, setDone] = useState(false);
  return (
    <section className="set-sec">
      <div className="set-row">
        <span>환경설정 초기화</span>
        <button
          className="set-btn"
          onClick={() => {
            reset();
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
        >
          {done ? "초기화됨" : "기본값으로"}
        </button>
      </div>
      <div className="set-hint">주문·화면·알림 설정만 초기화합니다(관심종목/자격증명 제외).</div>
    </section>
  );
}

// ---- 공통 소품 ----
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="set-stat-row">
      <span className="set-stat-label">{label}</span>
      <span className="set-stat-value mono">{value}</span>
    </div>
  );
}

function CredField({
  label,
  value,
  placeholder,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="set-cred-row">
      <span>{label}</span>
      <input
        className="mono"
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="op-seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`set-toggle ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <span className="set-toggle-knob" />
    </button>
  );
}

function SchemeBtn({
  active,
  onClick,
  up,
  down,
  label,
}: {
  active: boolean;
  onClick: () => void;
  up: string;
  down: string;
  label: string;
}) {
  return (
    <button className={`set-scheme-btn ${active ? "on" : ""}`} onClick={onClick}>
      <span className="set-swatch" style={{ background: up }} />
      <span className="set-swatch" style={{ background: down }} />
      {label}
    </button>
  );
}

const fmtExpiry = (v: string | null | undefined): string => {
  if (!v) return "미발급";
  const t = new Date(v.replace(" ", "T"));
  if (Number.isNaN(t.getTime())) return v;
  const expired = t.getTime() < Date.now();
  return `${v}${expired ? " (만료)" : ""}`;
};
