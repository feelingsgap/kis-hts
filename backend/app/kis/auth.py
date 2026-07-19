"""TokenManager — open-trading-api의 kis_auth를 래핑한 토큰 관리.

설계 원칙(auto-trading 참고):
- REST access token과 WS approval_key를 분리 관리.
- 토큰은 1일 유효, 재발급 1회/분 제한 → open-trading-api가 ~/KIS/config/ 파일 캐시로 재사용.
- 만료 전 선제 갱신(reauth_margin) — HTS 단독 운영이므로 메모리+파일 2단계로 충분.

주의: kis_auth는 모듈 전역 상태(_TRENV, _base_headers)를 사용하므로 단일 계좌 전제.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta

from app.config import bootstrap_open_trading_api, get_settings, load_credentials

_ka = None  # kis_auth 모듈 지연 로딩 캐시


def _mask(v: str | None) -> str | None:
    """자격증명 표시용 마스킹 (앞 6 + … + 뒤 2). 짧으면 전부 가림."""
    if not v:
        return None
    return f"{v[:6]}…{v[-2:]}" if len(v) > 8 else "•" * len(v)


def _apply_repo_credentials(ka) -> None:
    """repo config/{env}/.env 의 자격증명을 kis_auth._cfg 에 주입(yaml 값 오버라이드).

    auto-trading의 config/{prod,vps} 패턴 — 자격증명을 repo에서 모의/실전 분리 관리.
    repo 자격증명이 없으면(파일 없음/빈값) 기존 kis_devlp.yaml 값을 그대로 사용(하위호환).
    토큰 파일 캐시는 여전히 ~/KIS/config/ 에 저장된다.
    """
    env = get_settings().env
    creds = load_credentials(env)
    if not creds.get("app_key") or not creds.get("app_secret"):
        return
    cfg = ka.getEnv()  # _cfg (가변 dict)
    if env == "vps":
        cfg["paper_app"] = creds["app_key"]
        cfg["paper_sec"] = creds["app_secret"]
        if creds.get("account"):
            cfg["my_paper_stock"] = creds["account"]
    else:
        cfg["my_app"] = creds["app_key"]
        cfg["my_sec"] = creds["app_secret"]
        if creds.get("account"):
            cfg["my_acct_stock"] = creds["account"]
    if creds.get("hts_id"):
        cfg["my_htsid"] = creds["hts_id"]
    if creds.get("prod"):
        cfg["my_prod"] = creds["prod"]


def _load_ka():
    """kis_auth를 지연 로딩하고 repo 자격증명을 주입한다.

    kis_auth는 import 시 ~/KIS/config/kis_devlp.yaml을 읽으므로(URL/에이전트 등 정적값),
    자격증명이 없어도 /health 등이 뜨도록 최초 사용 시점까지 로딩을 미룬다.
    실제 앱키/시크릿/계좌/HTS ID는 repo config/{env}/.env 로 오버라이드한다.
    """
    global _ka
    if _ka is None:
        bootstrap_open_trading_api()
        import kis_auth as ka  # noqa: PLC0415  (지연 import 의도)

        _apply_repo_credentials(ka)
        _ka = ka
    return _ka


class TokenManager:
    """REST/WS 인증을 초기화하고 주기적으로 재인증한다."""

    def __init__(self, reauth_margin: timedelta = timedelta(hours=1)) -> None:
        self._settings = get_settings()
        self._lock = threading.Lock()
        self._rest_authed_at: datetime | None = None
        self._ws_authed_at: datetime | None = None
        self._reauth_margin = reauth_margin

    def _isolate_token_cache(self, ka) -> None:
        """토큰 캐시 파일을 env(vps/prod)에 맞는 계좌로 지정한다.

        open-trading-api의 read_token/save_token(acct_no=None)은 my_acct_stock(실전 계좌)
        기준 단일 파일(token_tmp)을 실전/모의가 공유해, vps가 실전 토큰을 재사용하면
        EGW00123(만료)이 난다. env에 맞는 계좌(모의 my_paper_stock / 실전 my_acct_stock)로
        token_tmp를 지정하면 계좌번호가 달라 파일이 자연히 분리된다(별도 접미사 불필요).
        """
        cfg = ka.getEnv()
        acct = cfg["my_paper_stock"] if self._settings.env == "vps" else cfg["my_acct_stock"]
        ka.token_tmp = ka._get_token_path(str(acct))

    # ---- REST ----
    def ensure_rest(self) -> None:
        """REST 토큰 확보. 캐시가 있으면 재사용(파일 캐시)한다."""
        ka = _load_ka()
        with self._lock:
            self._isolate_token_cache(ka)
            ka.auth(svr=self._settings.svr, product=self._settings.product)
            self._rest_authed_at = datetime.now()

    # ---- WebSocket ----
    def ensure_ws(self) -> None:
        """WS approval_key 확보."""
        ka = _load_ka()
        with self._lock:
            ka.auth_ws(svr=self._settings.svr, product=self._settings.product)
            self._ws_authed_at = datetime.now()

    def ensure_all(self) -> None:
        self.ensure_rest()
        self.ensure_ws()

    # ---- 환경 조회 ----
    @property
    def trenv(self):
        """KISEnv namedtuple(my_app, my_sec, my_acct, my_prod, my_htsid, my_token, my_url, my_url_ws)."""
        return _load_ka().getTREnv()

    @property
    def account(self) -> tuple[str, str]:
        """(CANO 8자리, ACNT_PRDT_CD 2자리)."""
        env = self.trenv
        return env.my_acct, env.my_prod

    @property
    def hts_id(self) -> str:
        return self.trenv.my_htsid

    def status(self) -> dict:
        return {
            "env": self._settings.env,
            "svr": self._settings.svr,
            "product": self._settings.product,
            "rest_authed_at": self._rest_authed_at.isoformat() if self._rest_authed_at else None,
            "ws_authed_at": self._ws_authed_at.isoformat() if self._ws_authed_at else None,
            "account": self.account if self._rest_authed_at else None,
        }

    # ---- 설정화면용 상세 상태/제어 ----
    def token_valid_until(self) -> str | None:
        """토큰 캐시 파일(valid-date)에서 만료일시 문자열을 읽는다. 없으면 None."""
        ka = _load_ka()
        try:
            self._isolate_token_cache(ka)
            with open(ka.token_tmp, encoding="utf-8") as f:
                return json.load(f).get("valid-date")
        except (OSError, ValueError, KeyError):
            return None

    def settings_status(self) -> dict:
        """설정화면용 상세 상태. 앱키는 마스킹, 앱시크릿은 설정 여부만(값 미반환)."""
        s = self._settings
        creds = load_credentials(s.env)
        out: dict = {
            "env": s.env,
            "svr": s.svr,
            "env_dv": s.env_dv,
            "product": s.product,
            "account": None,
            "hts_id": None,
            "app_key_masked": None,
            "has_secret": bool(creds.get("app_secret")),
            "token_valid_until": self.token_valid_until(),
            "rest_authed_at": self._rest_authed_at.isoformat() if self._rest_authed_at else None,
            "ws_authed_at": self._ws_authed_at.isoformat() if self._ws_authed_at else None,
        }
        try:
            env = self.trenv
            out["account"] = env.my_acct
            out["hts_id"] = env.my_htsid
            out["app_key_masked"] = _mask(env.my_app)
        except Exception:  # noqa: BLE001 (자격증명 미설정 시 빈 상태 반환)
            pass
        return out

    def refresh_token(self) -> None:
        """토큰 캐시를 지우고 강제 재인증(KIS는 6시간 내 동일 토큰 반환할 수 있음)."""
        ka = _load_ka()
        with self._lock:
            self._isolate_token_cache(ka)
            try:
                os.remove(ka.token_tmp)
            except OSError:
                pass
            ka.auth(svr=self._settings.svr, product=self._settings.product)
            self._rest_authed_at = datetime.now()

    def apply_credentials(self) -> None:
        """repo config/{env}/.env 를 재적용하고 재인증한다(자격증명 편집 반영)."""
        ka = _load_ka()
        _apply_repo_credentials(ka)
        with self._lock:
            self._isolate_token_cache(ka)
            ka.auth(svr=self._settings.svr, product=self._settings.product)
            self._rest_authed_at = datetime.now()


# 프로세스 단일 인스턴스 (모듈 전역 kis_auth 상태와 1:1 대응)
token_manager = TokenManager()
