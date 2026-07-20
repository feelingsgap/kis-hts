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
import functools
import logging
import threading
from datetime import datetime

from app.config import get_settings
from app.kis import bars
from app.kis.auth import _load_ka, token_manager
from app.realtime import hub

logger = logging.getLogger("kis.ws")
_settings = get_settings()

MAX_SYMBOLS = 19


def _pad_columns(builder, extra: int = 24):
    """open-trading-api WS 빌더의 컬럼 목록 끝에 여유 패딩을 덧붙인다.

    KIS 실시간 프레임의 실제 필드 수가 라이브러리 컬럼 정의보다 많으면
    (실측: H0STASP0 호가는 62필드인데 asking_price_krx는 59컬럼) 라이브러리의
    ``pd.read_csv(..., names=columns)``가 초과 필드를 행 인덱스로 흡수하며 데이터가
    왼쪽으로 밀린다 → MKSC_SHRN_ISCD(종목코드) 자리에 가격이 들어가 종목 매핑이 깨지고
    (호가가 엉뚱한 key로 저장돼) 프론트 호가창이 갱신되지 않는다.
    컬럼 수를 실제 필드 수보다 넉넉히 두면 read_csv가 왼쪽 정렬해 data[0]=종목코드가
    정상 매핑되고, 남는 패딩 컬럼은 NaN이 되어 무해하다.

    ⚠️ **단일 레코드(001) 스트림에만 적용**한다. 체결(H0STCNT0)처럼 한 프레임에
    여러 레코드가 이어붙는(필드수 = N×컬럼수) 멀티레코드 스트림은 패딩하면 그 정수배
    관계가 깨져 pandas가 행/인덱스를 잘못 나눈다(오히려 정렬이 망가짐). 호가(H0STASP0)와
    체결통보(H0STCNI0/9)는 프레임당 1레코드라 안전하다."""

    @functools.wraps(builder)  # __name__ 보존 → open_map 키 동일 유지
    def wrapped(*args, **kwargs):
        msg, columns = builder(*args, **kwargs)
        return msg, list(columns) + [f"_PAD{i}" for i in range(extra)]

    return wrapped


def _patch_cni_decrypt(ka) -> None:
    """체결통보(H0STCNI0/9) 복호화 강제.

    KIS 서버가 체결통보 구독 응답 헤더에 encrypt='N'을 주지만(복호화 키/iv는 output으로 제공)
    실제 실시간 데이터는 '1|H0STCNI9|...' AES 암호화로 온다. 라이브러리(kis_auth.__subscriber)는
    data_map[tr_id]['encrypt']=='Y'일 때만 복호화하므로, 그대로 두면 암호문을 CSV 파싱해
    체결 필드(CNTG_YN/종목/구분 등)가 깨진다 → fill 미발행 → 체결통보 음성·즉시 잔고 갱신 안 됨.
    add_data_map(모듈 전역)을 감싸 CNI tr_id의 encrypt를 'Y'로 승격한다(키/iv는 응답 값 사용)."""
    if getattr(ka, "_cni_decrypt_patched", False):
        return
    _orig = ka.add_data_map

    def _patched(tr_id, columns=None, encrypt=None, key=None, iv=None):
        if encrypt is not None and tr_id in ("H0STCNI0", "H0STCNI9"):
            encrypt = "Y"
        return _orig(tr_id, columns=columns, encrypt=encrypt, key=key, iv=iv)

    ka.add_data_map = _patched
    ka._cni_decrypt_patched = True


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
        # 컬럼 패딩(_pad_columns): 실시간 프레임 필드 수 > 라이브러리 컬럼 수일 때의 정렬 붕괴 방지.
        # 단일레코드 스트림(호가·체결통보)만 패딩. 체결(멀티레코드)은 패딩 시 정수배 관계가 깨져 원본 유지.
        if symbols:
            ka.KISWebSocket.subscribe(ws_mod.ccnl_krx, symbols, {"env_dv": env_dv})                        # 체결(멀티레코드 → 패딩 금지)
            ka.KISWebSocket.subscribe(_pad_columns(ws_mod.asking_price_krx), symbols, {"env_dv": env_dv})  # 호가(단일레코드)
        hts_id = token_manager.hts_id
        if hts_id:
            ka.KISWebSocket.subscribe(_pad_columns(ws_mod.ccnl_notice), [hts_id], {"env_dv": env_dv})       # 체결통보(단일레코드)

    def start(self, symbols: list[str]) -> None:
        if self._started:
            return
        self._symbols = [s for s in dict.fromkeys(symbols) if s][:MAX_SYMBOLS]
        token_manager.ensure_rest()
        token_manager.ensure_ws()

        ka = _load_ka()
        _patch_cni_decrypt(ka)  # 체결통보 복호화 강제(encrypt='N' 응답 우회)
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
        if tr_id == "H0STCNT0":  # 체결틱 → 1분봉 스토어에 누적(모든 레코드)
            today = datetime.now().strftime("%Y%m%d")
            for row in df.to_dict("records"):
                bars.on_tick(
                    row.get("MKSC_SHRN_ISCD"),
                    row.get("BSOP_DATE") or today,
                    str(row.get("STCK_CNTG_HOUR") or ""),
                    _i(row.get("STCK_PRPR")),
                    _i(row.get("CNTG_VOL")),
                )
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
            msg = {
                "type": "orderbook",
                "symbol": r.get("MKSC_SHRN_ISCD"),
                "time": r.get("BSOP_HOUR"),
                "asks": asks,
                "bids": bids,
                "total_ask_qty": _i(r.get("TOTAL_ASKP_RSQN")),
                "total_bid_qty": _i(r.get("TOTAL_BIDP_RSQN")),
            }
            # 예상체결(ANTC_*): 동시호가(장 시작·마감 전)에만 >0. 연속매매 중엔 0이라 생략.
            antc = _i(r.get("ANTC_CNPR"))
            if antc:
                msg["exp_price"] = antc
                msg["exp_qty"] = _i(r.get("ANTC_CNQN"))
                msg["exp_change_rate"] = _f(r.get("ANTC_CNTG_PRDY_CTRT"))
            return msg
        if tr_id in ("H0STCNI0", "H0STCNI9"):  # 체결통보 (CNTG_YN 1:주문접수 / 2:체결)
            cntg_yn = str(r.get("CNTG_YN"))
            if cntg_yn not in ("1", "2"):  # 그 외(정정/취소/거부 등)는 무시
                return None
            return {
                "type": "fill",
                "event": "fill" if cntg_yn == "2" else "accept",  # 접수와 체결은 다른 이벤트
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
