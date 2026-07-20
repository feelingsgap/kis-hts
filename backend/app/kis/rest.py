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
from app.kis import bars
from app.kis.auth import _load_ka, token_manager

_settings = get_settings()
# 모의(vps) 초당 제한(EGW00201) 회피 간격. 실전 70ms.
# 주의: 0.55s는 동시 버스트에서 ~17% EGW00201 실패(실측)라 상향함.
_MIN_INTERVAL = 0.8 if _settings.env == "vps" else 0.07


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

_RATELIMIT_CODE = "EGW00201"  # KIS "초당 거래건수를 초과하였습니다"


def _kis(fn, *args, **kwargs):
    """KIS 조회 호출을 rate limiter로 직렬화하고, 초당 제한(EGW00201) 응답이면 재시도한다.

    간격(_MIN_INTERVAL)만으로는 KIS 모의 서버가 동시 버스트에서 EGW00201을 간헐 반환한다
    (실측: 0.55s ~17%, 0.8s ~8% 실패). open-trading-api는 이 에러를 stdout에 찍고 빈 결과를
    돌려주므로, 캡처한 출력에서 코드를 감지해 백오프 후 재시도한다. 조회(read) 전용 —
    주문 등 상태 변경 호출은 무분별 재시도가 위험하므로 이 헬퍼를 쓰지 않는다.
    반환값(DataFrame 또는 (df1, df2) 튜플)은 그대로 통과시킨다.
    """
    result = None
    for attempt in range(4):
        _limiter.wait()
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            result = fn(*args, **kwargs)
        out = buf.getvalue()
        if out:
            print(out, end="")  # 캡처한 라이브러리 로그를 그대로 재출력
        if _RATELIMIT_CODE in out and attempt < 3:
            time.sleep(0.5 * (attempt + 1))  # 0.5s → 1.0s → 1.5s 백오프
            continue
        return result
    return result


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
    df = _kis(_ds().inquire_price, env_dv=_env(), fid_cond_mrkt_div_code=market, fid_input_iscd=symbol)
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
    df1, df2 = _kis(
        _ds().inquire_asking_price_exp_ccn,
        env_dv=_env(), fid_cond_mrkt_div_code=market, fid_input_iscd=symbol,
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
    _, df2 = _kis(
        _ds().inquire_daily_itemchartprice,
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
# KIS 국내 분봉은 1분봉만 제공. 부족한 히스토리만 inquire_time_dailychartprice(콜당 120봉,
# env_dv 없음)로 백필해 bars 스토어(SQLite)에 저장하고, 이후엔 실시간 틱 누적분과 함께
# 저장된 1분봉을 N분으로 집계해 서빙한다(요청마다 페이지네이션하던 방식 대체 → 전환 빠름).
_backfilled: set[str] = set()


def _minus_1min(hhmmss: str) -> str | None:
    try:
        total = int(hhmmss[0:2]) * 60 + int(hhmmss[2:4]) - 1
    except (ValueError, IndexError):
        return None
    return None if total < 0 else f"{total // 60:02d}{total % 60:02d}00"


def _backfill_ones(symbol: str, market: str, base_date: str, base_hour: str, pages: int = 5) -> list[dict]:
    """inquire_time_dailychartprice(120봉/콜)로 당일 1분봉을 뒤로 백필.

    earliest 시각 기준 walk-back(장외에도 데이터 자체 기준). 자정 넘는(전 영업일) 확장은
    하지 않고 당일 위주 — 다일 히스토리는 틱 누적으로 축적된다. 초당 제한 탓 페이지 상한.
    inquire_time_dailychartprice는 env_dv를 받지 않는 단일 TR_ID이며 output2에 1분봉이 담긴다."""
    seen: dict[tuple, dict] = {}
    cur_hour = base_hour
    prev_earliest: str | None = None
    for _ in range(pages):
        _, df2 = _kis(
            _ds().inquire_time_dailychartprice,
            fid_cond_mrkt_div_code=market,
            fid_input_iscd=symbol,
            fid_input_hour_1=cur_hour,
            fid_input_date_1=base_date,
            fid_pw_data_incu_yn="Y",
        )
        if df2 is None or df2.empty:
            break
        rows = [r for r in df2.to_dict("records") if r.get("stck_cntg_hour")]
        if not rows:
            break
        for r in rows:
            t = str(r.get("stck_cntg_hour"))
            seen[(r.get("stck_bsop_date"), t)] = {
                "date": r.get("stck_bsop_date"),
                "time": t if len(t) == 6 else t.ljust(6, "0"),
                "open": _to_int(r.get("stck_oprc")),
                "high": _to_int(r.get("stck_hgpr")),
                "low": _to_int(r.get("stck_lwpr")),
                "close": _to_int(r.get("stck_prpr")),
                "volume": _to_int(r.get("cntg_vol")),
            }
        earliest = min(str(r["stck_cntg_hour"]) for r in rows)
        if prev_earliest is not None and earliest >= prev_earliest:
            break
        if earliest <= "090100":  # 장 시작 도달
            break
        prev_earliest = earliest
        nxt = _minus_1min(earliest)
        if not nxt:
            break
        cur_hour = nxt
    return list(seen.values())


def _aggregate_minutes(ones: list[dict], interval: int) -> list[dict]:
    """1분봉을 interval분 버킷으로 집계(OHLCV). 버킷 시각=버킷 시작시각."""
    buckets: dict[tuple, dict] = {}
    order: list[tuple] = []
    for c in ones:
        t = c["time"]
        mins = int(t[0:2]) * 60 + int(t[2:4])
        b = mins // interval
        key = (c["date"], b)
        bk = buckets.get(key)
        if bk is None:
            start = b * interval
            buckets[key] = {
                "date": c["date"],
                "time": f"{start // 60:02d}{start % 60:02d}00",
                "open": c["open"],
                "high": c["high"],
                "low": c["low"],
                "close": c["close"],
                "volume": c["volume"] or 0,
            }
            order.append(key)
        else:
            if c["high"] is not None:
                bk["high"] = c["high"] if bk["high"] is None else max(bk["high"], c["high"])
            if c["low"] is not None:
                bk["low"] = c["low"] if bk["low"] is None else min(bk["low"], c["low"])
            if c["close"] is not None:
                bk["close"] = c["close"]
            bk["volume"] = (bk["volume"] or 0) + (c["volume"] or 0)
    return [buckets[k] for k in sorted(order)]


def minute_chart(
    symbol: str, base_hour: str, market: str = "J", past: str = "Y", interval: int = 1
) -> dict:
    """분봉. interval(분)=1/3/5/10/30/60. bars 스토어(틱 누적 + REST 백필)에서 집계.

    최초 1회(또는 데이터 희소 시) REST 백필 → SQLite. 이후엔 인터벌 전환마다 저장된
    1분봉을 재집계만 하므로 재조회가 없다(전환 즉시)."""
    from datetime import datetime  # noqa: PLC0415

    # 세션당 1회 백필 시도. 단, 이미 하루치(≥300봉)가 SQLite에 있으면 건너뜀(재기동 후 즉시).
    if symbol not in _backfilled and bars.count(symbol) < 300:
        base_date = datetime.now().strftime("%Y%m%d")
        got = _backfill_ones(symbol, market, base_date, base_hour or datetime.now().strftime("%H%M%S"))
        if got:
            bars.save_bars(symbol, got)
    _backfilled.add(symbol)
    ones = bars.get_ones(symbol)
    candles = ones if interval <= 1 else _aggregate_minutes(ones, interval)
    return {"symbol": symbol, "period": f"M{interval}", "candles": candles[-120:]}


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


# ---------- 업종 지수 (KOSPI/KOSDAQ) ----------
# inquire_index_price는 env_dv를 받지 않고 단일 TR_ID. 시장="U", 종목=지수코드.
_INDEX = {
    "kospi": {"iscd": "0001", "name": "코스피"},
    "kosdaq": {"iscd": "1001", "name": "코스닥"},
    "kospi200": {"iscd": "2001", "name": "코스피200"},
}


def market_index(code: str) -> dict:
    meta = _INDEX.get(code)
    if not meta:
        return {}
    df = _kis(_ds().inquire_index_price, fid_cond_mrkt_div_code="U", fid_input_iscd=meta["iscd"])
    if df is None or df.empty:
        return {}
    r = df.iloc[0].to_dict()
    return {
        "code": code,
        "name": meta["name"],
        "value": _to_float(_get(r, "bstp_nmix_prpr")),          # 지수 현재가
        "change": _to_float(_get(r, "bstp_nmix_prdy_vrss")),    # 전일 대비
        "change_rate": _to_float(_get(r, "bstp_nmix_prdy_ctrt")),  # 전일 대비율
        "sign": _get(r, "prdy_vrss_sign"),                      # 1상한 2상승 3보합 4하한 5하락
    }


# ---------- 종목 정보 (재무비율 / 투자의견 / 뉴스) — 모두 모의 지원 확인 ----------
def stock_financials(symbol: str, market: str = "J") -> list[dict]:
    """최근 결산 재무비율(년). ROE/EPS/BPS/부채비율/증가율."""
    df = _kis(
        _ds().finance_financial_ratio,
        fid_div_cls_code="0", fid_cond_mrkt_div_code=market, fid_input_iscd=symbol,
    )
    if df is None or df.empty:
        return []
    return [
        {
            "period": _get(r, "stac_yymm"),                     # 결산년월
            "roe": _to_float(_get(r, "roe_val")),
            "eps": _to_float(_get(r, "eps")),
            "bps": _to_float(_get(r, "bps")),
            "debt_ratio": _to_float(_get(r, "lblt_rate")),      # 부채비율
            "sales_growth": _to_float(_get(r, "grs")),          # 매출액증가율
            "profit_growth": _to_float(_get(r, "bsop_prfi_inrt")),  # 영업이익증가율
        }
        for r in df.to_dict("records")[:6]
    ]


def stock_opinions(symbol: str, market: str = "J") -> list[dict]:
    """최근 90일 증권사 투자의견."""
    from datetime import datetime as _dt, timedelta as _td

    today = _dt.now()
    start = (today - _td(days=90)).strftime("%Y%m%d")
    df = _kis(
        _ds().invest_opinion,
        fid_cond_mrkt_div_code=market, fid_cond_scr_div_code="16633", fid_input_iscd=symbol,
        fid_input_date_1=start, fid_input_date_2=today.strftime("%Y%m%d"),
    )
    if df is None or df.empty:
        return []
    out = []
    for r in df.to_dict("records")[:15]:
        if not _get(r, "invt_opnn"):
            continue
        out.append({
            "date": _get(r, "stck_bsop_date"),
            "opinion": _get(r, "invt_opnn"),        # 매수/중립/매도 등
            "member": _get(r, "mbcr_name"),         # 회원사(증권사)
            "goal_price": _to_int(_get(r, "hts_goal_prc")),  # 목표가
        })
    return out


def stock_news(symbol: str) -> list[dict]:
    """종목 관련 뉴스 제목(최근)."""
    df = _kis(
        _ds().news_title,
        fid_news_ofer_entp_code="", fid_cond_mrkt_cls_code="", fid_input_iscd=symbol,
        fid_titl_cntt="", fid_input_date_1="", fid_input_hour_1="",
        fid_rank_sort_cls_code="", fid_input_srno="",
    )
    if df is None or df.empty:
        return []
    out = []
    for r in df.to_dict("records")[:20]:
        title = _get(r, "hts_pbnt_titl_cntt")
        if not title:
            continue
        out.append({
            "date": _get(r, "data_dt"),
            "time": _get(r, "data_tm"),
            "title": title,
            "source": _get(r, "dorg"),              # 언론사
        })
    return out


# ---------- 잔고 ----------
def balance() -> dict:
    cano, prod = _acct()
    df1, df2 = _kis(
        _ds().inquire_balance,
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
    cano, prod = _acct()
    df = _kis(
        _ds().inquire_psbl_order,
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

    cano, prod = _acct()
    today = _dt.now().strftime("%Y%m%d")
    df1, _ = _kis(
        _ds().inquire_daily_ccld,
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

    cano, prod = _acct()
    today = _dt.now().strftime("%Y%m%d")
    df1, _ = _kis(
        _ds().inquire_daily_ccld,
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
