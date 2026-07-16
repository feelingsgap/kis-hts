"""백엔드 설정 및 open-trading-api 부트스트랩.

- 로컬 sidecar 서버 설정(포트, 환경, 계좌 상품코드)을 관리한다.
- open-trading-api(kis_auth, 함수 모듈, WS 빌더)를 import 할 수 있도록 sys.path를 구성한다.

환경변수(.env 또는 프로세스 환경)로 오버라이드 가능:
  KIS_HTS_ENV      prod | vps         (기본 vps = 모의투자)
  KIS_HTS_PRODUCT  계좌 상품코드 2자리  (기본 01 = 종합/주식)
  KIS_HTS_PORT     로컬 서버 포트       (기본 8787)
  OPEN_TRADING_API_PATH  open-trading-api 리포 경로(개발 중 이웃 repo 직접 참조)

KIS 자격증명은 repo `config/{vps,prod}/.env`(auto-trading config/{vps,prod} 패턴, git 무시)에서
`load_credentials(env)`로 로드해 kis_auth._cfg에 주입한다. 토큰 파일 캐시는 ~/KIS/config/ 유지.

용어: KIS는 svr=prod(실전)/vps(모의)와 env_dv=real(실전)/demo(모의) 두 규칙을 쓴다.
env(=svr)를 prod/vps로 두고, 국내주식 함수용 env_dv(real/demo)는 매핑 프로퍼티로 제공한다.
"""
from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

from dotenv import dotenv_values
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[2]  # kis-hts/
# 개발 기본값: 이웃 리포지토리를 직접 참조. 배포 시 vendor/ 서브모듈로 교체.
_DEFAULT_OTA = Path.home() / "work" / "git" / "open-trading-api"
_VENDOR_OTA = _REPO_ROOT / "backend" / "vendor" / "open-trading-api"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KIS_HTS_", env_file=".env", extra="ignore")

    env: str = "vps"           # vps(모의) | prod(실전) — 기본 vps
    product: str = "01"        # 계좌 상품코드 2자리
    port: int = 8787
    host: str = "127.0.0.1"    # 로컬 전용

    @property
    def svr(self) -> str:
        """open-trading-api auth의 svr 인자 (= env). 실전 'prod' / 모의 'vps'.
        미지정/오타는 안전하게 vps(모의)로 처리."""
        return "prod" if self.env == "prod" else "vps"

    @property
    def env_dv(self) -> str:
        """open-trading-api 국내주식 함수의 env_dv 인자: 실전 'real' / 모의 'demo'."""
        return "real" if self.env == "prod" else "demo"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def load_credentials(env: str) -> dict[str, str]:
    """repo `config/{env}/.env`(vps|prod)에서 KIS 자격증명을 로드.

    auto-trading의 config/{vps,prod} 패턴을 따른다. 파일이 없거나 앱키가 비면
    빈 dict를 반환하며, 이 경우 백엔드는 기존 ~/KIS/config/kis_devlp.yaml 값을 쓴다(하위호환).
    """
    path = _REPO_ROOT / "config" / env / ".env"
    if not path.exists():
        return {}
    v = dotenv_values(path)
    return {
        "app_key": (v.get("KIS_APP_KEY") or "").strip(),
        "app_secret": (v.get("KIS_APP_SECRET") or "").strip(),
        "account": (v.get("KIS_ACCT") or "").strip(),
        "hts_id": (v.get("KIS_HTS_ID") or "").strip(),
        "prod": (v.get("KIS_PROD") or "01").strip(),
    }


def bootstrap_open_trading_api() -> Path:
    """open-trading-api 경로를 찾아 sys.path에 등록하고 그 경로를 반환.

    우선순위: OPEN_TRADING_API_PATH 환경변수 > vendor/ 서브모듈 > 이웃 repo.
    kis_auth 와 국내주식 WS 빌더(examples_user/domestic_stock)를 import 가능하게 한다.
    """
    override = os.environ.get("OPEN_TRADING_API_PATH")
    candidates = [Path(override)] if override else []
    candidates += [_VENDOR_OTA, _DEFAULT_OTA]

    root = next((p for p in candidates if (p / "kis_auth.py").exists()), None)
    if root is None:
        raise FileNotFoundError(
            "open-trading-api를 찾을 수 없습니다. OPEN_TRADING_API_PATH를 설정하거나 "
            "backend/vendor/open-trading-api 서브모듈을 추가하세요."
        )

    ws_dir = root / "examples_user" / "domestic_stock"
    for p in (str(root), str(ws_dir)):
        if p not in sys.path:
            sys.path.insert(0, p)
    return root
