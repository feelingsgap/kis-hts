"""REST 시세 래퍼 + rate limiter.

open-trading-api의 국내주식 함수를 호출하고 pandas.DataFrame 결과를 JSON 직렬화
가능한 dict로 정규화한다. 초당 호출 제한(EGW00201) 회피를 위해 호출을 직렬화한다.

FastAPI의 sync(def) 엔드포인트/threadpool에서 호출되므로 스레드 안전해야 한다.
"""
from __future__ import annotations

import contextlib
import io
import re
import threading
import time

from app.config import get_settings
from app.kis.auth import _load_ka, token_manager

_settings = get_settings()
# 모의(vps) 초당 제한(EGW00201) 실측: 0.5s 간격까지 안전 → 0.55s(여유). 실전 70ms.
# (기존 1.1s는 과도하게 보수적이라 로딩이 느렸음)
_MIN_INTERVAL = 0.55 if _settings.env == "vps" else 0.07


class RateLimiter:
    def __init__(self, min_interval: float) -> None:
        self._min = min_interval
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delta = now - self._last
            if delta < self._min:
                time.sleep(self._min - delta)
            self._last = time.monotonic()


_limiter = RateLimiter(_MIN_INTERVAL)


def _ds():
    """국내주식 함수 모듈을 지연 import (kis_auth 부트스트랩으로 sys.path 보장)."""
    _load_ka()  # sys.path 등록 보장
    import domestic_stock_functions as ds  # noqa: PLC0415

    return ds


def _env() -> str:
    # open-trading-api 국내주식 함수의 env_dv 인자: 실전 'real' / 모의 'demo'
    return _settings.env_dv


# ---------- 현재가 ----------
def current_price(symbol: str, market: str = "J") -> dict:
    _limiter.wait()
    df = _ds().inquire_price(env_dv=_env(), fid_cond_mrkt_div_code=market, fid_input_iscd=symbol)
    if df is None or df.empty:
        return {}
    r = df.iloc[0].to_dict()
    return {
        "symbol": symbol,
        "price": _to_int(r.get("stck_prpr")),
        "change": _to_int(r.get("prdy_vrss")),
        "change_rate": _to_float(r.get("prdy_ctrt")),
        "sign": r.get("prdy_vrss_sign"),        # 1상한 2상승 3보합 4하한 5하락
        "open": _to_int(r.get("stck_oprc")),
        "high": _to_int(r.get("stck_hgpr")),
        "low": _to_int(r.get("stck_lwpr")),
        "volume": _to_int(r.get("acml_vol")),
        "value": _to_int(r.get("acml_tr_pbmn")),
        "upper": _to_int(r.get("stck_mxpr")),   # 상한가
        "lower": _to_int(r.get("stck_llam")),   # 하한가
        "raw": r,
    }


# ---------- 호가 (10호가) ----------
def orderbook(symbol: str, market: str = "J") -> dict:
    _limiter.wait()
    df1, df2 = _ds().inquire_asking_price_exp_ccn(
        env_dv=_env(), fid_cond_mrkt_div_code=market, fid_input_iscd=symbol
    )
    if df1 is None or df1.empty:
        return {}
    r = df1.iloc[0].to_dict()
    asks = [
        {"price": _to_int(r.get(f"askp{i}")), "qty": _to_int(r.get(f"askp_rsqn{i}"))}
        for i in range(1, 11)
    ]
    bids = [
        {"price": _to_int(r.get(f"bidp{i}")), "qty": _to_int(r.get(f"bidp_rsqn{i}"))}
        for i in range(1, 11)
    ]
    # 예상체결 (df2). 장전/장중 예상체결가·수량.
    exp = df2.iloc[0].to_dict() if df2 is not None and not df2.empty else {}
    return {
        "symbol": symbol,
        "asks": asks,   # 매도호가 1~10
        "bids": bids,   # 매수호가 1~10
        "total_ask_qty": _to_int(r.get("total_askp_rsqn")),
        "total_bid_qty": _to_int(r.get("total_bidp_rsqn")),
        "exp_price": _to_int(_get(exp, "antc_cnpr")),                # 예상체결가
        "exp_qty": _to_int(_get(exp, "antc_cnqn", "antc_vol")),      # 예상체결수량
        "exp_change_rate": _to_float(_get(exp, "antc_cntg_prdy_ctrt")),  # 예상체결 등락률
    }


# ---------- 일봉 차트 ----------
def daily_chart(
    symbol: str, start: str, end: str, market: str = "J", period: str = "D", adj: str = "0"
) -> dict:
    """period: D(일)/W(주)/M(월)/Y(년), adj: 0(수정주가) 1(원주가). 날짜 YYYYMMDD."""
    _limiter.wait()
    _, df2 = _ds().inquire_daily_itemchartprice(
        env_dv=_env(),
        fid_cond_mrkt_div_code=market,
        fid_input_iscd=symbol,
        fid_input_date_1=start,
        fid_input_date_2=end,
        fid_period_div_code=period,
        fid_org_adj_prc=adj,
    )
    if df2 is None or df2.empty:
        return {"symbol": symbol, "candles": []}
    candles = [
        {
            "date": row.get("stck_bsop_date"),
            "open": _to_int(row.get("stck_oprc")),
            "high": _to_int(row.get("stck_hgpr")),
            "low": _to_int(row.get("stck_lwpr")),
            "close": _to_int(row.get("stck_clpr")),
            "volume": _to_int(row.get("acml_vol")),
        }
        for row in df2.to_dict("records")
        if row.get("stck_bsop_date")
    ]
    return {"symbol": symbol, "period": period, "candles": candles}


# ---------- 분봉 차트 ----------
def minute_chart(symbol: str, base_hour: str, market: str = "J", past: str = "Y") -> dict:
    """당일 분봉. base_hour=기준시간 HHMMSS(이 시각까지 최대 30봉), past=과거포함 Y/N."""
    _limiter.wait()
    _, df2 = _ds().inquire_time_itemchartprice(
        env_dv=_env(),
        fid_cond_mrkt_div_code=market,
        fid_input_iscd=symbol,
        fid_input_hour_1=base_hour,
        fid_pw_data_incu_yn=past,
        fid_etc_cls_code="",
    )
    if df2 is None or df2.empty:
        return {"symbol": symbol, "period": "M1", "candles": []}
    candles = [
        {
            "date": row.get("stck_bsop_date"),
            "time": row.get("stck_cntg_hour"),  # HHMMSS
            "open": _to_int(row.get("stck_oprc")),
            "high": _to_int(row.get("stck_hgpr")),
            "low": _to_int(row.get("stck_lwpr")),
            "close": _to_int(row.get("stck_prpr")),
            "volume": _to_int(row.get("cntg_vol")),
        }
        for row in df2.to_dict("records")
        if row.get("stck_cntg_hour")
    ]
    return {"symbol": symbol, "period": "M1", "candles": candles}


# ========== P3: 잔고 / 주문 ==========
def _get(d: dict, *keys: str):
    """대소문자 무시 키 조회 (조회는 소문자, 주문응답은 대문자 키 혼재)."""
    low = {k.lower(): v for k, v in d.items()}
    for k in keys:
        if k.lower() in low:
            return low[k.lower()]
    return None


def _acct() -> tuple[str, str]:
    token_manager.ensure_rest()
    return token_manager.account  # (CANO, ACNT_PRDT_CD)


# ---------- 잔고 ----------
def balance() -> dict:
    _limiter.wait()
    cano, prod = _acct()
    df1, df2 = _ds().inquire_balance(
        env_dv=_env(), cano=cano, acnt_prdt_cd=prod,
        afhr_flpr_yn="N", inqr_dvsn="02", unpr_dvsn="01",
        fund_sttl_icld_yn="N", fncg_amt_auto_rdpt_yn="N", prcs_dvsn="00",
    )
    holdings = []
    if df1 is not None and not df1.empty:
        for r in df1.to_dict("records"):
            qty = _to_int(_get(r, "hldg_qty"))
            if not qty:
                continue
            holdings.append({
                "symbol": _get(r, "pdno"),
                "name": _get(r, "prdt_name"),
                "qty": qty,
                "orderable_qty": _to_int(_get(r, "ord_psbl_qty")),
                "avg_price": _to_int(_get(r, "pchs_avg_pric")),
                "price": _to_int(_get(r, "prpr")),
                "eval_amount": _to_int(_get(r, "evlu_amt")),
                "pnl": _to_int(_get(r, "evlu_pfls_amt")),
                "pnl_rate": _to_float(_get(r, "evlu_pfls_rt")),
            })
    summary = {}
    if df2 is not None and not df2.empty:
        s = df2.iloc[0].to_dict()
        summary = {
            "deposit": _to_int(_get(s, "dnca_tot_amt")),            # 예수금총액
            "deposit_d2": _to_int(_get(s, "prvs_rcdl_excc_amt")),   # D+2 예수금
            "eval_total": _to_int(_get(s, "tot_evlu_amt")),         # 총평가금액
            "purchase_total": _to_int(_get(s, "pchs_amt_smtl_amt")), # 매입금액합계
            "securities_eval": _to_int(_get(s, "scts_evlu_amt")),   # 유가평가금액
            "pnl_total": _to_int(_get(s, "evlu_pfls_smtl_amt")),    # 평가손익합계
            "net_asset": _to_int(_get(s, "nass_amt")),              # 순자산
        }
    # 당일 실현손익 추가 (모의투자는 inquire_balance_rlz_pl 미지원 → 당일 체결 라운드트립 근사)
    summary["realized_pnl"] = _realized_pnl_from_fills()
    return {"summary": summary, "holdings": holdings}


def _realized_pnl_from_fills() -> int | None:
    """당일 체결내역으로 실현손익 근사. 종목별 min(매수량,매도량)×(평균매도가−평균매수가). 수수료·세금 제외."""
    from collections import defaultdict

    try:
        fills = filled_orders()
    except Exception:
        return None
    if not fills:
        return None
    buy_amt: dict = defaultdict(int)
    buy_qty: dict = defaultdict(int)
    sell_amt: dict = defaultdict(int)
    sell_qty: dict = defaultdict(int)
    for f in fills:
        sym = f.get("symbol")
        q = f.get("filled_qty") or 0
        p = f.get("avg_price") or f.get("price") or 0
        if f.get("side") == "buy":
            buy_amt[sym] += q * p
            buy_qty[sym] += q
        else:
            sell_amt[sym] += q * p
            sell_qty[sym] += q
    realized = 0
    closed_any = False
    for sym in set(buy_qty) | set(sell_qty):
        bq, sq = buy_qty[sym], sell_qty[sym]
        closed = min(bq, sq)
        if closed <= 0:
            continue
        avg_buy = buy_amt[sym] / bq if bq else 0
        avg_sell = sell_amt[sym] / sq if sq else 0
        realized += round(closed * (avg_sell - avg_buy))
        closed_any = True
    return realized if closed_any else None


# ---------- 매수가능조회 ----------
def psbl_order(symbol: str, price: int, ord_dvsn: str = "00") -> dict:
    _limiter.wait()
    cano, prod = _acct()
    df = _ds().inquire_psbl_order(
        env_dv=_env(), cano=cano, acnt_prdt_cd=prod, pdno=symbol,
        ord_unpr=str(price), ord_dvsn=ord_dvsn,
        cma_evlu_amt_icld_yn="N", ovrs_icld_yn="N",
    )
    if df is None or df.empty:
        return {}
    r = df.iloc[0].to_dict()
    return {
        "symbol": symbol,
        "orderable_cash": _to_int(_get(r, "ord_psbl_cash")),   # 주문가능현금
        "buyable_amount": _to_int(_get(r, "nrcvb_buy_amt")),   # 미수없는매수금액
        "buyable_qty": _to_int(_get(r, "nrcvb_buy_qty")),      # 미수없는매수수량
        "max_buy_amount": _to_int(_get(r, "max_buy_amt")),     # 최대매수금액
        "max_buy_qty": _to_int(_get(r, "max_buy_qty")),        # 최대매수수량
    }


# ---------- 주문 (현금 매수/매도) ----------
def place_order(side: str, symbol: str, qty: int, price: int, ord_dvsn: str = "00") -> dict:
    """side: buy/sell, ord_dvsn: 00 지정가 / 01 시장가. 시장가는 price=0."""
    _limiter.wait()
    cano, prod = _acct()
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        df = _ds().order_cash(
            env_dv=_env(), ord_dv=side, cano=cano, acnt_prdt_cd=prod,
            pdno=symbol, ord_dvsn=ord_dvsn, ord_qty=str(qty),
            ord_unpr=str(price), excg_id_dvsn_cd="KRX",
        )
    if df is not None and not df.empty:
        r = df.iloc[0].to_dict()
        return {
            "ok": True,
            "order_no": _get(r, "ODNO", "odno"),
            "org_no": _get(r, "KRX_FWDG_ORD_ORGNO", "krx_fwdg_ord_orgno"),
            "time": _get(r, "ORD_TMD", "ord_tmd"),
        }
    return {"ok": False, "error": _extract_err(buf.getvalue())}


# ---------- 정정/취소 ----------
def revise_cancel(
    org_no: str, order_no: str, rvse_cncl: str, qty: int, price: int,
    ord_dvsn: str = "00", qty_all: str = "Y",
) -> dict:
    """rvse_cncl: 01 정정 / 02 취소. qty_all: Y 전량 / N 일부."""
    _limiter.wait()
    cano, prod = _acct()
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        df = _ds().order_rvsecncl(
            env_dv=_env(), cano=cano, acnt_prdt_cd=prod,
            krx_fwdg_ord_orgno=org_no, orgn_odno=order_no, ord_dvsn=ord_dvsn,
            rvse_cncl_dvsn_cd=rvse_cncl, ord_qty=str(qty), ord_unpr=str(price),
            qty_all_ord_yn=qty_all, excg_id_dvsn_cd="KRX",
        )
    if df is not None and not df.empty:
        r = df.iloc[0].to_dict()
        return {"ok": True, "order_no": _get(r, "ODNO", "odno")}
    return {"ok": False, "error": _extract_err(buf.getvalue())}


# ---------- 미체결 조회 ----------
# 모의투자에서 inquire_psbl_rvsecncl은 빈 값 → inquire_daily_ccld(미체결)로 조회.
def pending_orders() -> list[dict]:
    from datetime import datetime as _dt

    _limiter.wait()
    cano, prod = _acct()
    today = _dt.now().strftime("%Y%m%d")
    df1, _ = _ds().inquire_daily_ccld(
        env_dv=_env(), pd_dv="inner", cano=cano, acnt_prdt_cd=prod,
        inqr_strt_dt=today, inqr_end_dt=today, sll_buy_dvsn_cd="00",
        ccld_dvsn="02", inqr_dvsn="00", inqr_dvsn_3="00",
    )
    out = []
    if df1 is not None and not df1.empty:
        for r in df1.to_dict("records"):
            rmn = _to_int(_get(r, "rmn_qty"))
            if not rmn:  # 잔량 없는 건 제외
                continue
            out.append({
                "order_no": _get(r, "odno"),
                "org_no": _get(r, "ord_gno_brno"),
                "symbol": _get(r, "pdno"),
                "name": _get(r, "prdt_name"),
                # inquire_daily_ccld: 01 매도 / 02 매수
                "side": "buy" if str(_get(r, "sll_buy_dvsn_cd")) == "02" else "sell",
                "qty": _to_int(_get(r, "ord_qty")),
                "filled_qty": _to_int(_get(r, "tot_ccld_qty")),
                "cancelable_qty": rmn,
                "price": _to_int(_get(r, "ord_unpr")),
            })
    return out


# ---------- 체결내역 (오늘 체결 완료) ----------
def filled_orders() -> list[dict]:
    from datetime import datetime as _dt

    _limiter.wait()
    cano, prod = _acct()
    today = _dt.now().strftime("%Y%m%d")
    df1, _ = _ds().inquire_daily_ccld(
        env_dv=_env(), pd_dv="inner", cano=cano, acnt_prdt_cd=prod,
        inqr_strt_dt=today, inqr_end_dt=today, sll_buy_dvsn_cd="00",
        ccld_dvsn="01", inqr_dvsn="00", inqr_dvsn_3="00",  # 01: 체결
    )
    out = []
    if df1 is not None and not df1.empty:
        for r in df1.to_dict("records"):
            filled = _to_int(_get(r, "tot_ccld_qty"))
            if not filled:  # 체결수량 0 제외
                continue
            out.append({
                "order_no": _get(r, "odno"),
                "symbol": _get(r, "pdno"),
                "name": _get(r, "prdt_name"),
                "side": "buy" if str(_get(r, "sll_buy_dvsn_cd")) == "02" else "sell",
                "qty": _to_int(_get(r, "ord_qty")),
                "filled_qty": filled,
                "price": _to_int(_get(r, "ord_unpr")),
                "avg_price": _to_int(_get(r, "avg_prvs", "ccld_avg_unpr")),  # 체결평균가
                "time": _get(r, "ord_tmd"),
            })
    return out


def _extract_err(stdout: str) -> str:
    m = re.search(r"msg1\s*:\s*(.+?)(?:\n|$)", stdout)
    if m:
        return m.group(1).strip()
    m = re.search(r'"msg1"\s*:\s*"([^"]+)"', stdout)
    return m.group(1) if m else "주문 처리 실패"


# ---------- 형변환 유틸 ----------
def _to_int(v) -> int | None:
    try:
        return int(float(str(v).strip())) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


def _to_float(v) -> float | None:
    try:
        return float(str(v).strip()) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None
