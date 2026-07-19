// 탭 데이터 캐시 훅. 같은 key면 재조회하지 않고, 종목/시장 등 key가 바뀌면 조회.
// ttlMs>0이면 TTL 만료 시 재조회(순위 등 시장 데이터). signal 증가 시 강제 재조회(새로고침 버튼).
import { useEffect, useRef, useState } from "react";

interface Entry {
  data: unknown;
  ts: number;
}
const mem = new Map<string, Entry>();

function peek<T>(key: string, ttlMs: number): T | null {
  const e = mem.get(key);
  if (!e) return null;
  if (ttlMs > 0 && Date.now() - e.ts > ttlMs) return null;
  return e.data as T;
}

export function useCached<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  ttlMs = 0,
  signal = 0,
): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(() => (key ? peek<T>(key, ttlMs) : null));
  const [loading, setLoading] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher; // 항상 최신 fetcher(현재 종목 클로저) 참조

  const load = (k: string, force: boolean, alive: { v: boolean }) => {
    if (!force) {
      const c = peek<T>(k, ttlMs);
      if (c !== null) {
        setData(c);
        return; // 캐시 히트 → 조회 안 함
      }
    }
    setLoading(true);
    fetcherRef
      .current()
      .then((r) => {
        mem.set(k, { data: r, ts: Date.now() });
        if (alive.v) setData(r);
      })
      .catch(() => {})
      .finally(() => {
        if (alive.v) setLoading(false);
      });
  };

  // 마운트/키 변경: 캐시 우선(있으면 즉시 표시, 없으면 조회)
  useEffect(() => {
    if (!key) {
      setData(null);
      return;
    }
    const alive = { v: true };
    setData(peek<T>(key, ttlMs));
    load(key, false, alive);
    return () => {
      alive.v = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ttlMs]);

  // 새로고침 신호: signal이 실제로 바뀔 때만 강제 조회.
  // (마지막 처리값과 비교 → 마운트나 StrictMode 재실행에선 발생하지 않음)
  const lastSignal = useRef(signal);
  useEffect(() => {
    if (lastSignal.current === signal) return;
    lastSignal.current = signal;
    if (!key) return;
    const alive = { v: true };
    load(key, true, alive);
    return () => {
      alive.v = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);

  return { data, loading };
}
