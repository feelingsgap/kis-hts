// UI 설정 localStorage 영속 (차트 기간·지표 토글·탭·선택종목 등)
import { useEffect, useState } from "react";

const PREFIX = "kis-hts:";

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function savePref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* 저장 실패(용량/프라이빗 모드 등)는 무시 */
  }
}

// localStorage 백업 useState. 값이 바뀌면 자동 저장, 초기값은 저장분 우선.
export function usePersisted<T>(key: string, fallback: T): [T, (v: T | ((p: T) => T)) => void] {
  const [state, setState] = useState<T>(() => loadPref(key, fallback));
  useEffect(() => {
    savePref(key, state);
  }, [key, state]);
  return [state, setState];
}
