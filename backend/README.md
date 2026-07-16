# kis-hts-backend

KIS OpenAPI macOS HTS의 로컬 sidecar 백엔드 (FastAPI). 설계는 [`../docs/DESIGN.md`](../docs/DESIGN.md) 참고.

## 사전 준비
1. `open-trading-api` 리포지토리 확보 (개발 중에는 이웃 repo 자동 참조, 배포 시 `vendor/` 서브모듈).
2. `~/KIS/config/kis_devlp.yaml`에 **모의투자** 앱키/시크릿/HTS ID/계좌번호 설정.
   (open-trading-api 루트의 `kis_devlp.yaml` 템플릿을 복사)

## 실행 (개발)
```bash
cd backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8787 --reload
```

## 환경변수
| 변수 | 기본값 | 설명 |
|---|---|---|
| `KIS_HTS_ENV` | `demo` | `demo`(모의) / `real`(실전) |
| `KIS_HTS_PRODUCT` | `01` | 계좌 상품코드 2자리 |
| `KIS_HTS_PORT` | `8787` | 로컬 서버 포트 |
| `OPEN_TRADING_API_PATH` | (자동탐색) | open-trading-api 경로 오버라이드 |

## 확인
- `GET /health` → `{"ok": true, "env": "demo", "svr": "vps"}`
- `GET /api/auth/status` → 토큰/계좌 상태
- `WS /ws` → 실시간 브로드캐스트 채널

## 진행 상태 (P0)
- [x] 프로젝트 구조 · config · TokenManager · 로컬 WS 허브 뼈대
- [ ] (P1) KIS WS 매니저 스레드 + 호가/체결 릴레이
- [ ] (P1~P3) 시세/차트/잔고/주문 라우터
