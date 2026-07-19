// 사용자 환경설정(주문 기본값 / 화면 / 알림). localStorage 영속 + zustand 반응 공유.
// 서버 상태(자격증명 등)가 아니라 순수 클라이언트 선호값만 담는다.
import { create } from "zustand";
import { loadPref, savePref } from "./persist";
import type { OrdDvsn } from "./types";

export type ColorScheme = "kr" | "global"; // 한국식(상승red/하락blue) / 글로벌식(상승green/하락red)

export interface Settings {
  // B 주문 기본값
  orderDefaultType: OrdDvsn; // 신규 주문 패널 기본 유형
  qtyPresets: number[]; // 수량 비율 프리셋(%)
  confirmEnabled: boolean; // 주문 확인창 표시
  // C 화면
  colorScheme: ColorScheme;
  // D 알림
  toastEnabled: boolean; // 체결 토스트
  soundEnabled: boolean; // 체결/알림 소리
}

export const DEFAULTS: Settings = {
  orderDefaultType: "00",
  qtyPresets: [25, 50, 100],
  confirmEnabled: true,
  colorScheme: "kr",
  toastEnabled: true,
  soundEnabled: false,
};

interface SettingsState extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

const KEY = "settings";
const saved = loadPref<Partial<Settings>>(KEY, {});

function persist(s: Settings): void {
  savePref(KEY, {
    orderDefaultType: s.orderDefaultType,
    qtyPresets: s.qtyPresets,
    confirmEnabled: s.confirmEnabled,
    colorScheme: s.colorScheme,
    toastEnabled: s.toastEnabled,
    soundEnabled: s.soundEnabled,
  });
}

export const useSettings = create<SettingsState>((set) => ({
  ...DEFAULTS,
  ...saved,
  set: (key, value) =>
    set((st) => {
      const next = { ...st, [key]: value };
      persist(next);
      return { [key]: value } as Partial<SettingsState>;
    }),
  reset: () =>
    set(() => {
      persist(DEFAULTS);
      return { ...DEFAULTS };
    }),
}));
