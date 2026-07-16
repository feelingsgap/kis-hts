"""KIS WebSocket 매니저 — 실시간 체결/호가/체결통보를 로컬 허브로 릴레이.

open-trading-api의 KISWebSocket을 별도 daemon 스레드에서 기동한다.
  - kws.start()는 asyncio.run 기반 블로킹 루프 → Thread에서 실행
  - on_result(ws, tr_id, df, data_info) 콜백(ws 스레드)에서 정규화 후
    hub.publish_threadsafe() 로 메인 asyncio 루프에 안전하게 전달

구독: 종목당 2건(체결 H0STCNT0 + 호가 H0STASP0) + 체결통보 1건(H0STCNI0/9, HTS ID 기준).
총 구독 40건 제한 → 종목 최대 19개(2*19+1=39).

동적 구독(관심종목 변경): open_map을 갱신하고 현재 연결을 끊어 __runner가 재연결하며
새 open_map으로 재구독하게 한다(라이브러리 __runner의 재연결 재구독 활용).
"""
from __future__ import annotations

import asyncio
import logging
import threading

from app.config import get_settings
from app.kis.auth import _load_ka, token_manager
from app.realtime import hub

logger = logging.getLogger("kis.ws")
_settings = get_settings()

MAX_SYMBOLS = 19


class KisWsManager:
    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._symbols: list[str] = []
        self._started = False
        self._ws = None                       # 라이브 websocket (재구독 시 끊기용)
        self._ws_loop: asyncio.AbstractEventLoop | None = None

    @property
    def subscriptions(self) -> dict:
        return {"symbols": self._symbols, "started": self._started, "streams": ["체결", "호가", "체결통보"]}

    def _register(self, ka, ws_mod, symbols: list[str]) -> None:
        """open_map을 비우고 현재 종목 + 체결통보 구독을 등록."""
        ka.open_map.clear()
        env_dv = _settings.env_dv  # WS 빌더의 env_dv: 실전 'real' / 모의 'demo'
        if symbols:
            ka.KISWebSocket.subscribe(ws_mod.ccnl_krx, symbols, {"env_dv": env_dv})         # 체결
            ka.KISWebSocket.subscribe(ws_mod.asking_price_krx, symbols, {"env_dv": env_dv})  # 호가
        hts_id = token_manager.hts_id
        if hts_id:
            ka.KISWebSocket.subscribe(ws_mod.ccnl_notice, [hts_id], {"env_dv": env_dv})       # 체결통보

    def start(self, symbols: list[str]) -> None:
        if self._started:
            return
        self._symbols = [s for s in dict.fromkeys(symbols) if s][:MAX_SYMBOLS]
        token_manager.ensure_rest()
        token_manager.ensure_ws()

        ka = _load_ka()
        import domestic_stock_functions_ws as ws_mod  # noqa: PLC0415

        kws = ka.KISWebSocket(api_url="/tryitout", max_retries=100000)  # 동적 재연결 위해 크게
        self._register(ka, ws_mod, self._symbols)

        def _run() -> None:
            try:
                kws.start(on_result=self._on_result)
            except Exception:
                logger.exception("KIS WS 스레드 종료")

        self._thread = threading.Thread(target=_run, name="kis-ws", daemon=True)
        self._thread.start()
        self._started = True
        logger.info("KIS WS 시작: %s (+체결통보)", self._symbols)

    def resubscribe(self, symbols: list[str]) -> None:
        """관심종목 변경 반영: open_map 갱신 후 연결을 끊어 재연결·재구독 유도."""
        self._symbols = [s for s in dict.fromkeys(symbols) if s][:MAX_SYMBOLS]
        if not self._started:
            self.start(self._symbols)
            return
        ka = _load_ka()
        import domestic_stock_functions_ws as ws_mod  # noqa: PLC0415

        self._register(ka, ws_mod, self._symbols)
        # 현재 연결을 끊어 __runner가 새 open_map으로 재구독하게 함
        if self._ws is not None and self._ws_loop is not None:
            try:
                asyncio.run_coroutine_threadsafe(self._ws.close(), self._ws_loop)
            except Exception:
                logger.exception("WS 재구독용 연결 종료 실패")
        logger.info("KIS WS 재구독: %s", self._symbols)

    # ws 스레드에서 호출됨
    def _on_result(self, ws, tr_id: str, df, data_info) -> None:
        # 재구독용으로 라이브 ws + 루프 저장
        self._ws = ws
        try:
            self._ws_loop = asyncio.get_running_loop()
        except RuntimeError:
            pass
        if df is None or df.empty:
            return
        r = df.iloc[0].to_dict()
        msg = self._normalize(tr_id, r)
        if msg:
            hub.publish_threadsafe(msg)

    @staticmethod
    def _normalize(tr_id: str, r: dict) -> dict | None:
        if tr_id == "H0STCNT0":  # 실시간 체결
            return {
                "type": "tick",
                "symbol": r.get("MKSC_SHRN_ISCD"),
                "time": r.get("STCK_CNTG_HOUR"),
                "price": _i(r.get("STCK_PRPR")),
                "change": _i(r.get("PRDY_VRSS")),
                "change_rate": _f(r.get("PRDY_CTRT")),
                "sign": r.get("PRDY_VRSS_SIGN"),
                "cntg_vol": _i(r.get("CNTG_VOL")),
                "acml_vol": _i(r.get("ACML_VOL")),
            }
        if tr_id == "H0STASP0":  # 실시간 호가 10단계
            asks = [
                {"price": _i(r.get(f"ASKP{i}")), "qty": _i(r.get(f"ASKP_RSQN{i}"))}
                for i in range(1, 11)
            ]
            bids = [
                {"price": _i(r.get(f"BIDP{i}")), "qty": _i(r.get(f"BIDP_RSQN{i}"))}
                for i in range(1, 11)
            ]
            return {
                "type": "orderbook",
                "symbol": r.get("MKSC_SHRN_ISCD"),
                "time": r.get("BSOP_HOUR"),
                "asks": asks,
                "bids": bids,
                "total_ask_qty": _i(r.get("TOTAL_ASKP_RSQN")),
                "total_bid_qty": _i(r.get("TOTAL_BIDP_RSQN")),
            }
        if tr_id in ("H0STCNI0", "H0STCNI9"):  # 체결통보
            if str(r.get("CNTG_YN")) != "2":  # 2:체결만 (1:주문접수 제외)
                return None
            return {
                "type": "fill",
                "symbol": r.get("STCK_SHRN_ISCD"),
                "name": r.get("CNTG_ISNM40"),
                "side": "buy" if str(r.get("SELN_BYOV_CLS")) == "02" else "sell",
                "qty": _i(r.get("CNTG_QTY")),
                "price": _i(r.get("CNTG_UNPR")),
                "time": r.get("STCK_CNTG_HOUR"),
                "order_no": r.get("ODER_NO"),
            }
        return None


def _i(v) -> int | None:
    try:
        return int(float(str(v).strip())) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


def _f(v) -> float | None:
    try:
        return float(str(v).strip()) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


ws_manager = KisWsManager()
