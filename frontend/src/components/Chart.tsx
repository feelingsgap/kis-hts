import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, CandlestickChart, LineChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import { api } from "../api";
import { useStore } from "../store";
import { usePersisted } from "../persist";
import { bollinger, macd, rsi, sma } from "../indicators";
import type { Candle, ChartPeriod } from "../types";

echarts.use([
  CandlestickChart,
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  AxisPointerComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

const UP = "#ff5b52"; // 상승(빨강)
const DOWN = "#5b9bff"; // 하락(파랑)
const MA = [
  { period: 5, name: "MA5", color: "#f1c40f" },
  { period: 20, name: "MA20", color: "#9b59b6" },
  { period: 60, name: "MA60", color: "#e67e22" },
];
const PERIODS: { key: ChartPeriod; label: string }[] = [
  { key: "M1", label: "1분" },
  { key: "D", label: "일" },
  { key: "W", label: "주" },
  { key: "M", label: "월" },
];
const THEME = {
  axis: "#29313c",
  split: "rgba(60,70,82,0.35)",
  label: "#a4aeba",
  tipBg: "#1b222b",
  tipBorder: "#3b4652",
  tipText: "#e7eaef",
  legend: "#a4aeba",
};

// 보조패널 토글
interface Panels {
  vol: boolean;
  rsi: boolean;
  macd: boolean;
  bb: boolean;
}

function xlabel(c: Candle, minute: boolean): string {
  const d = c.date;
  if (minute && c.time) return `${c.time.slice(0, 2)}:${c.time.slice(2, 4)}`;
  return `${d.slice(4, 6)}/${d.slice(6, 8)}`;
}

// 동적 그리드 배치: 캔들 + 활성 보조패널(거래량/RSI/MACD)
function layout(active: string[]) {
  const top0 = 5;
  const bottom = 9;
  const gap = 1.5;
  const n = active.length;
  const subH = n === 0 ? 0 : n === 1 ? 18 : n === 2 ? 15 : 13;
  const candleH = 100 - top0 - bottom - n * (subH + gap);
  const grids: Record<string, unknown>[] = [
    { left: 8, right: 58, top: `${top0}%`, height: `${candleH}%` },
  ];
  let y = top0 + candleH + gap;
  const idx: Record<string, number> = {};
  active.forEach((k, i) => {
    grids.push({ left: 8, right: 58, top: `${y}%`, height: `${subH}%` });
    idx[k] = i + 1;
    y += subH + gap;
  });
  return { grids, idx };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tooltipFmt(params: any): string {
  if (!params || !params.length) return "";
  const fmt = (v: unknown) =>
    typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("ko-KR") : v.toFixed(2)) : "-";
  const lines = [`<b>${params[0].axisValue ?? ""}</b>`];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params.forEach((p: any) => {
    if (p.seriesName === "봉" && Array.isArray(p.value)) {
      const a = p.value;
      const [o, c, l, h] = [a[a.length - 4], a[a.length - 3], a[a.length - 2], a[a.length - 1]];
      lines.push(`시 ${fmt(o)}  고 ${fmt(h)}  저 ${fmt(l)}  종 ${fmt(c)}`);
    } else if (p.seriesName === "거래량") {
      const vol = typeof p.value === "object" && p.value ? p.value.value : p.value;
      lines.push(`거래량 ${fmt(vol)}`);
    } else if (p.value != null) {
      const raw = typeof p.value === "object" && p.value ? p.value.value : p.value;
      const val = Array.isArray(raw) ? raw[1] : raw;
      if (val != null) lines.push(`${p.marker} ${p.seriesName} ${fmt(val)}`);
    }
  });
  return lines.join("<br>");
}

// 시리즈 배열 (초기 렌더 + 실시간 tick 병합에 공용) — 토글 순서가 고정이므로 index 안정
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSeries(candles: Candle[], idx: Record<string, number>, p: Panels): any[] {
  const closes = candles.map((c) => c.close ?? 0);
  const ohlc = candles.map((c) => [c.open ?? 0, c.close ?? 0, c.low ?? 0, c.high ?? 0]);
  const bb = bollinger(closes, 20, 2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: any[] = [
    {
      name: "봉",
      type: "candlestick",
      data: ohlc,
      xAxisIndex: 0,
      yAxisIndex: 0,
      itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
    },
    ...MA.map((m) => ({
      name: m.name,
      type: "line",
      data: sma(closes, m.period),
      xAxisIndex: 0,
      yAxisIndex: 0,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 1, color: m.color },
      itemStyle: { color: m.color },
    })),
    {
      name: "BB상",
      type: "line",
      data: p.bb ? bb.upper : [],
      xAxisIndex: 0,
      yAxisIndex: 0,
      showSymbol: false,
      lineStyle: { width: 1, type: "dashed", color: "rgba(255,91,82,0.55)" },
      itemStyle: { color: "rgba(255,91,82,0.55)" },
    },
    {
      name: "BB하",
      type: "line",
      data: p.bb ? bb.lower : [],
      xAxisIndex: 0,
      yAxisIndex: 0,
      showSymbol: false,
      lineStyle: { width: 1, type: "dashed", color: "rgba(91,155,255,0.55)" },
      itemStyle: { color: "rgba(91,155,255,0.55)" },
    },
  ];
  if (p.vol) {
    s.push({
      name: "거래량",
      type: "bar",
      data: candles.map((c) => ({
        value: c.volume ?? 0,
        itemStyle: {
          color: (c.close ?? 0) >= (c.open ?? 0) ? "rgba(255,91,82,0.5)" : "rgba(91,155,255,0.5)",
        },
      })),
      xAxisIndex: idx.vol,
      yAxisIndex: idx.vol,
      barMaxWidth: 8,
    });
  }
  if (p.rsi) {
    s.push({
      name: "RSI",
      type: "line",
      data: rsi(closes, 14),
      xAxisIndex: idx.rsi,
      yAxisIndex: idx.rsi,
      showSymbol: false,
      lineStyle: { width: 1, color: "#f39c12" },
      markLine: {
        silent: true,
        symbol: "none",
        label: { show: false },
        data: [
          { yAxis: 70, lineStyle: { color: "rgba(255,91,82,0.4)", type: "dashed" } },
          { yAxis: 30, lineStyle: { color: "rgba(91,155,255,0.4)", type: "dashed" } },
        ],
      },
    });
  }
  if (p.macd) {
    const m = macd(closes);
    s.push(
      {
        name: "MACD",
        type: "line",
        data: m.line,
        xAxisIndex: idx.macd,
        yAxisIndex: idx.macd,
        showSymbol: false,
        lineStyle: { width: 1, color: "#5b9bff" },
      },
      {
        name: "Signal",
        type: "line",
        data: m.signal,
        xAxisIndex: idx.macd,
        yAxisIndex: idx.macd,
        showSymbol: false,
        lineStyle: { width: 1, color: "#ff5b52" },
      },
      {
        name: "Hist",
        type: "bar",
        data: m.hist.map((v) => ({
          value: v,
          itemStyle: { color: v == null || v >= 0 ? "rgba(255,91,82,0.6)" : "rgba(91,155,255,0.6)" },
        })),
        xAxisIndex: idx.macd,
        yAxisIndex: idx.macd,
        barMaxWidth: 6,
      },
    );
  }
  return s;
}

function buildOption(candles: Candle[], minute: boolean, p: Panels): EChartsCoreOption {
  const active = [p.vol ? "vol" : "", p.rsi ? "rsi" : "", p.macd ? "macd" : ""].filter(Boolean);
  const { grids, idx } = layout(active);
  const dates = candles.map((c) => xlabel(c, minute));
  const nAxis = grids.length;

  const xAxis = grids.map((_, i) => ({
    type: "category" as const,
    data: dates,
    gridIndex: i,
    boundaryGap: true,
    axisLine: { lineStyle: { color: THEME.axis } },
    splitLine: { show: false },
    axisLabel: i === nAxis - 1 ? { color: THEME.label, fontSize: 10 } : { show: false },
    axisPointer: { label: { show: i === nAxis - 1 } },
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yAxis: any[] = [
    {
      scale: true,
      gridIndex: 0,
      position: "right",
      axisLine: { show: false },
      splitLine: { lineStyle: { color: THEME.split } },
      axisLabel: { color: THEME.label, fontSize: 10 },
    },
  ];
  active.forEach((k) => {
    if (k === "rsi") {
      yAxis.push({
        min: 0,
        max: 100,
        gridIndex: idx.rsi,
        position: "right",
        splitNumber: 2,
        axisLine: { show: false },
        splitLine: { show: false },
        axisLabel: { color: THEME.label, fontSize: 9 },
      });
    } else {
      yAxis.push({
        scale: true,
        gridIndex: idx[k],
        position: "right",
        splitNumber: 2,
        axisLine: { show: false },
        splitLine: { show: false },
        axisLabel: { color: THEME.label, fontSize: 9 },
      });
    }
  });

  return {
    animation: false,
    backgroundColor: "transparent",
    legend: {
      data: ["MA5", "MA20", "MA60", "BB상", "BB하"],
      top: 2,
      left: 8,
      itemWidth: 14,
      itemHeight: 8,
      textStyle: { color: THEME.legend, fontSize: 11 },
      inactiveColor: "#4a5461",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", lineStyle: { color: THEME.axis, width: 1 } },
      backgroundColor: THEME.tipBg,
      borderColor: THEME.tipBorder,
      textStyle: { color: THEME.tipText, fontSize: 11 },
      formatter: tooltipFmt,
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: grids,
    xAxis,
    yAxis,
    dataZoom: [
      { type: "inside", xAxisIndex: grids.map((_, i) => i), start: 0, end: 100 },
      {
        type: "slider",
        xAxisIndex: grids.map((_, i) => i),
        bottom: 2,
        height: 13,
        start: 0,
        end: 100,
        borderColor: THEME.axis,
        textStyle: { color: THEME.label, fontSize: 9 },
        brushSelect: false,
      },
    ],
    series: buildSeries(candles, idx, p),
  };
}

// 보조패널 토글 칩 정의
const TOGGLES: { key: keyof Panels; label: string }[] = [
  { key: "bb", label: "볼린저" },
  { key: "vol", label: "거래량" },
  { key: "rsi", label: "RSI" },
  { key: "macd", label: "MACD" },
];

export function Chart({ symbol }: { symbol: string }) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const loadedRef = useRef<{ symbol: string; period: ChartPeriod } | null>(null); // 현재 렌더된 종목/기간
  const [period, setPeriod] = usePersisted<ChartPeriod>("chart.period", "D");
  const [empty, setEmpty] = useState(false);
  const [panels, setPanels] = usePersisted<Panels>("chart.panels", {
    vol: true,
    rsi: true,
    macd: true,
    bb: true,
  });
  const panelsRef = useRef(panels); // 재조회 없이 최신 패널 참조

  const tickPrice = useStore((s) => s.quotes[symbol]?.price ?? null);

  // 인스턴스 1회 생성
  useEffect(() => {
    if (!box.current) return;
    const chart = echarts.init(box.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // 데이터 로드 (종목/기간 변경 시에만 재조회). 지표 토글로는 재조회하지 않음.
  useEffect(() => {
    let alive = true;
    // 종목/기간 전환 시 옛 캔들·로드정보 초기화 → stale 틱이 옛 봉에 반영되는 튀임 방지
    candlesRef.current = [];
    loadedRef.current = null;
    const minute = period === "M1";
    const req = minute ? api.chartMinute(symbol) : api.chartDaily(symbol, period);
    req
      .then((res) => {
        if (!alive || !chartRef.current) return;
        const candles = [...res.candles]
          .filter((c) => c.close != null)
          .sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
        candlesRef.current = candles;
        loadedRef.current = { symbol, period };
        setEmpty(candles.length === 0);
        chartRef.current.setOption(buildOption(candles, minute, panelsRef.current), {
          notMerge: true,
        });
      })
      .catch(() => alive && setEmpty(true));
    return () => {
      alive = false;
    };
  }, [symbol, period]);

  // 지표 패널 토글 → 재조회 없이 기존 캔들로 재렌더만
  useEffect(() => {
    panelsRef.current = panels;
    const cs = candlesRef.current;
    if (!chartRef.current || !cs.length) return;
    chartRef.current.setOption(buildOption(cs, period === "M1", panels), { notMerge: true });
  }, [panels, period]);

  // 실시간 봉 갱신 (로드 완료된 종목의 틱만 반영 → 종목전환 스파이크 방지)
  useEffect(() => {
    if (tickPrice == null || !chartRef.current) return;
    const loaded = loadedRef.current;
    if (!loaded || loaded.symbol !== symbol) return; // 아직 새 종목 데이터 로드 전이면 무시
    const cs = candlesRef.current;
    if (!cs.length) return;
    const last = cs[cs.length - 1];
    last.close = tickPrice;
    last.high = Math.max(last.high ?? tickPrice, tickPrice);
    last.low = last.low ? Math.min(last.low, tickPrice) : tickPrice;
    const p = panelsRef.current;
    const active = [p.vol ? "vol" : "", p.rsi ? "rsi" : "", p.macd ? "macd" : ""].filter(Boolean);
    const { idx } = layout(active);
    chartRef.current.setOption({ series: buildSeries(cs, idx, p) }, { notMerge: false });
  }, [tickPrice, symbol]);

  const toggle = (k: keyof Panels) => setPanels((p) => ({ ...p, [k]: !p[k] }));

  return (
    <div className="chart-panel">
      <div className="chart-head">
        <div className="chart-head-left">
          <span className="panel-title chart-title">차트</span>
          <div className="ind-toggle">
            {TOGGLES.map((t) => (
              <button
                key={t.key}
                className={panels[t.key] ? "on" : ""}
                onClick={() => toggle(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="period-toggle">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={period === p.key ? "on" : ""}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-canvas" ref={box} />
      {empty && <div className="chart-empty">데이터 없음 (장 시작 후 또는 다른 기간 선택)</div>}
    </div>
  );
}
