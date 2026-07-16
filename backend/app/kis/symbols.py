"""종목마스터 (코드→종목명) + 종목검색.

KIS가 제공하는 코스피/코스닥 종목마스터(.mst)를 내려받아 코드·종목명만 추출해
로컬 JSON으로 캐시한다(하루 1회 갱신). 마스터 확보 실패 시 inquire_price가 주는
hts_kor_isnm으로 온디맨드 캐싱하는 폴백을 둔다.

참고: open-trading-api/stocks_info/kis_kospi_code_mst.py 의 파싱 로직을 크로스플랫폼으로 옮김.
"""
from __future__ import annotations

import json
import logging
import os
import ssl
import tempfile
import threading
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("kis.symbols")

_CACHE_DIR = Path.home() / "KIS" / "config"
_CACHE_FILE = _CACHE_DIR / "symbol_master.json"

# (market, url, 뒷부분 길이) — 종목명 슬라이스용 trailing 길이(참고 스크립트 기준)
_MASTERS = [
    ("KOSPI", "https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip", 228),
    ("KOSDAQ", "https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip", 222),
]

_lock = threading.Lock()
_master: dict[str, dict] = {}  # code -> {"name": str, "market": str}
_loaded = False


def _parse_mst(path: str, trailing: int, market: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    with open(path, encoding="cp949") as f:
        for row in f:
            part1 = row[0 : len(row) - trailing]
            code = part1[0:9].rstrip()
            name = part1[21:].strip()
            if code and name:
                out[code] = {"name": name, "market": market}
    return out


def _download_and_parse() -> dict[str, dict]:
    ssl._create_default_https_context = ssl._create_unverified_context  # noqa: S323 (KIS 마스터 서버)
    result: dict[str, dict] = {}
    with tempfile.TemporaryDirectory() as tmp:
        for market, url, trailing in _MASTERS:
            try:
                zip_path = os.path.join(tmp, f"{market}.zip")
                urllib.request.urlretrieve(url, zip_path)  # noqa: S310
                with zipfile.ZipFile(zip_path) as zf:
                    zf.extractall(tmp)
                mst = next(
                    (os.path.join(tmp, n) for n in os.listdir(tmp) if n.endswith(".mst")), None
                )
                if mst:
                    result.update(_parse_mst(mst, trailing, market))
                    os.remove(mst)
                logger.info("%s 마스터 로드 (%d 누적)", market, len(result))
            except Exception:
                logger.exception("%s 마스터 다운로드 실패", market)
    return result


def _load() -> None:
    """캐시가 오늘자면 그대로, 아니면 다운로드 후 캐시."""
    global _master, _loaded
    with _lock:
        if _loaded:
            return
        today = datetime.now().strftime("%Y%m%d")
        # 캐시 파일 재사용
        if _CACHE_FILE.exists():
            try:
                data = json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
                if data.get("date") == today and data.get("symbols"):
                    _master = data["symbols"]
                    _loaded = True
                    logger.info("종목마스터 캐시 사용 (%d 종목)", len(_master))
                    return
            except Exception:
                logger.exception("종목마스터 캐시 읽기 실패")
        # 다운로드
        _master = _download_and_parse()
        _loaded = True
        if _master:
            try:
                _CACHE_DIR.mkdir(parents=True, exist_ok=True)
                _CACHE_FILE.write_text(
                    json.dumps({"date": today, "symbols": _master}, ensure_ascii=False),
                    encoding="utf-8",
                )
            except Exception:
                logger.exception("종목마스터 캐시 저장 실패")


def name_of(symbol: str) -> str | None:
    _load()
    e = _master.get(symbol)
    if e:
        return e["name"]
    # 폴백: 현재가 조회로 종목명 캐싱
    try:
        from app.kis import rest

        q = rest.current_price(symbol)
        nm = (q.get("raw") or {}).get("hts_kor_isnm") if q else None
        if nm:
            _master[symbol] = {"name": nm, "market": "?"}
            return nm
    except Exception:
        logger.debug("name_of 폴백 실패: %s", symbol)
    return None


def names_of(symbols: list[str]) -> dict[str, str]:
    return {s: (name_of(s) or s) for s in symbols}


def search(query: str, limit: int = 30) -> list[dict]:
    _load()
    q = (query or "").strip()
    if not q:
        return []
    out: list[dict] = []
    q_upper = q.upper()
    # 코드 우선(숫자) → prefix 매칭, 그 외 종목명 부분 매칭
    is_code = q.isdigit()
    for code, e in _master.items():
        if is_code:
            hit = code.startswith(q)
        else:
            hit = q_upper in e["name"].upper() or code.startswith(q)
        if hit:
            out.append({"symbol": code, "name": e["name"], "market": e["market"]})
            if len(out) >= limit:
                break
    # 코드 정렬
    out.sort(key=lambda x: x["symbol"])
    return out[:limit]
