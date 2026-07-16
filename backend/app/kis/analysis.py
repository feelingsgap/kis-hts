"""순위분석(거래량/등락률) + 투자자 매매동향.

open-trading-api의 volume_rank / fluctuation / inquire_investor를 래핑한다.
FID 파라미터는 examples_llm의 동작 예시값을 사용. 출력 필드는 대소문자·후보키로 견고하게 접근.
"""
from __future__ import annotations

from app.kis import symbols
from app.kis.rest import _ds, _env, _get, _limiter, _to_float, _to_int


def _name(code: str | None, fallback: str | None) -> str | None:
    if fallback:
        return fallback
    return symbols.name_of(code) if code else None


# ---------- 거래량 순위 ----------
def ranking_volume(limit: int = 30) -> list[dict]:
    _limiter.wait()
    df = _ds().volume_rank(
        fid_cond_mrkt_div_code="J",
        fid_cond_scr_div_code="20171",
        fid_input_iscd="0000",
        fid_div_cls_code="0",
        fid_blng_cls_code="0",
        fid_trgt_cls_code="111111111",
        fid_trgt_exls_cls_code="0000000000",
        fid_input_price_1="0",
        fid_input_price_2="1000000",
        fid_vol_cnt="100000",
        fid_input_date_1="",
    )
    if df is None or df.empty:
        return []
    out = []
    for r in df.to_dict("records")[:limit]:
        code = _get(r, "mksc_shrn_iscd", "stck_shrn_iscd")
        out.append({
            "rank": _to_int(_get(r, "data_rank", "rank")),
            "symbol": code,
            "name": _name(code, _get(r, "hts_kor_isnm")),
            "price": _to_int(_get(r, "stck_prpr")),
            "change_rate": _to_float(_get(r, "prdy_ctrt")),
            "volume": _to_int(_get(r, "acml_vol")),
            "value": _to_int(_get(r, "acml_tr_pbmn")),
        })
    return out


# ---------- 등락률 순위 ----------
def ranking_fluctuation(direction: str = "up", limit: int = 30) -> list[dict]:
    # 0: 상승률순 / 1: 하락률순
    sort_code = "1" if direction == "down" else "0"
    _limiter.wait()
    df = _ds().fluctuation(
        fid_cond_mrkt_div_code="J",
        fid_cond_scr_div_code="20170",
        fid_input_iscd="0000",
        fid_rank_sort_cls_code=sort_code,
        fid_input_cnt_1="0",
        fid_prc_cls_code="0",
        fid_input_price_1="",
        fid_input_price_2="",
        fid_vol_cnt="",
        fid_trgt_cls_code="0",
        fid_trgt_exls_cls_code="0",
        fid_div_cls_code="0",
        fid_rsfl_rate1="",
        fid_rsfl_rate2="",
    )
    if df is None or df.empty:
        return []
    out = []
    for r in df.to_dict("records")[:limit]:
        code = _get(r, "stck_shrn_iscd", "mksc_shrn_iscd")
        out.append({
            "rank": _to_int(_get(r, "data_rank", "rank")),
            "symbol": code,
            "name": _name(code, _get(r, "hts_kor_isnm")),
            "price": _to_int(_get(r, "stck_prpr")),
            "change_rate": _to_float(_get(r, "prdy_ctrt")),
        })
    return out


# ---------- 투자자 매매동향 (외국인/기관/개인) ----------
def investor(symbol: str, market: str = "J") -> dict:
    _limiter.wait()
    df = _ds().inquire_investor(
        env_dv=_env(), fid_cond_mrkt_div_code=market, fid_input_iscd=symbol
    )
    if df is None or df.empty:
        return {"symbol": symbol, "recent": []}
    recent = []
    for r in df.to_dict("records")[:20]:
        recent.append({
            "date": _get(r, "stck_bsop_date"),
            "foreign": _to_int(_get(r, "frgn_ntby_qty")),       # 외국인 순매수량
            "institution": _to_int(_get(r, "orgn_ntby_qty")),   # 기관계 순매수량
            "individual": _to_int(_get(r, "prsn_ntby_qty")),    # 개인 순매수량
            "close": _to_int(_get(r, "stck_clpr")),
        })
    return {"symbol": symbol, "recent": recent}
