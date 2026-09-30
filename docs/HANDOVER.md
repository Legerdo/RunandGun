# 인수인계 프롬프트 — RIVET RIOT 버그 수정 작업

> **2026-09-30 후속 작업 완료:** 아래 내용은 작업 시작 당시의 기록이다. 사망 스카프·음성 수정, 기존 수정 검증, 벙커 출입 충돌과 최종 보스 이벤트 누락 수정까지 마쳤다. 최신 결과와 재검증 명령은 [BUGFIXES.md](BUGFIXES.md)를 참고한다. 프로덕션 빌드 `dist/`도 갱신됐다.

## 프로젝트 개요

`c:\Users\K\DevSpaceWorkspaces\RunandGun` — **RIVET RIOT: Operation Saltbone**
TypeScript + Vite + 자체 소프트웨어 픽셀 렌더러(384×216)로 만든 2D 런앤건 게임.
전체 구조는 `docs/PROMPT.md`에 원문 요청이, `README.md`에 구현 설명이 있다.

---

## 현재 상황

6개 버그 수정 작업을 진행 중이었으며, **코드 편집은 완료됐으나 빌드 검증과 남은 버그 수정이 남아있다.**

---

## 완료된 수정 (코드 작성 완료, 아직 빌드·테스트 미확인)

| # | 버그 | 수정 내용 | 파일 |
|---|---|---|---|
| 1 | 타이틀 야자수 과도한 흔들림 | `palm()` 주기를 0.03→0.018로 줄이고, 줄기 전체가 아닌 가지 바깥쪽 절반만 흔들리도록 변경. 타이틀 배경에서 카메라 오프셋을 팜에 넘기던 버그(매 프레임 좌표가 소수점 반올림으로 달라져 흔들려 보임) 수정 | `src/game/bg.ts`, `src/game/stage.ts` |
| 2 | 보스전·화면 전환 시 카메라 급이동 | 카메라에 속도(`vx`) + 가속(`CAM_ACCEL`) 필드 추가 → 락/해제가 목표값만 바꾸고 카메라 자체는 매 프레임 최대 4.5px씩만 이동. `cutCamera()` 메서드로 섹션 시작·페이드 후 즉각 배치만 허용 | `src/game/world.ts`, `src/game/stage.ts` |
| 3 | 공격 표시 불명확 | 새 파일 `src/game/danger.ts` 생성 (공통 경고 시각화: `groundZone`, `lane`, `aimLine`, `alertBadge`). 박격포, 자이로 폭탄, 소총병/방패병 총구, 전차 MG·차지·평사포, 드레이진 버스트·람, 건십 레이저조준·스윕, 보스 내려찍기·휩쓸기·벨리개틀링·레이저에 적용 | `src/game/danger.ts` 외 다수 |
| 5 | 적 화면에 갑자기 나타남 | 벙커·MG 네스트 병력을 이벤트 스폰이 아닌 빌드 타임 배치로 변경(처음부터 화면 밖에 존재). 건물 문 킥오픈 연출(`kickDoor()`, `rattle`) 추가. 열차 드롭병에 `origin='vehicle'` 태그. 전차에 헐 플랫폼 솔리드 추가(점프로 올라탈 수 있게) | `src/game/stage.ts`, `src/game/decor.ts`, `src/game/vehicles.ts`, `src/game/enemies.ts` |

---

## 아직 미완료인 버그

### 버그 4 — 죽었을 때 스카프 어색함

**현황:** 진단만 완료. `whisper` 전사 결과 기준 `anchor=[-2,-23]`, `tip=[-11,-14]`.
사망 후 스카프 앵커가 발 위치를 따라가다 보니 공중에 떠있는 것처럼 보임.

**해야 할 일:**

`src/game/player.ts`의 `updateScarf()` 수정.

`state === 'dead'`일 때 앵커를 발 좌표가 아닌 몸의 실제 중심에 고정하거나, 사망 즉시 `scarf = []`로 초기화해서 스카프가 자연스럽게 낙하하도록 재생성하는 단순 해결책도 고려할 것.

진단 시나리오로 재측정:
```bash
node tools/play.mjs deathScarf
```

---

### 버그 6 — 죽었을 때 목소리 어색함

**현황:** 미수정.

`public/voice/hero_die.mp3`를 재생성해야 한다.
`tools/check_voices.py`(faster-whisper 전사)로 확인했을 때 현재 클립은 `"Oh!"` — 너무 짧고 비명 느낌이 없다.

**해야 할 일:**

1. `tools/gen_voices.py`에서 `hero_die` 항목 텍스트 수정.
   - 권장 예시: `"[screaming] Noooo!"` 또는 `"[screaming] Aaargh!"` 등 명확하게 비명 지르는 라인.
   - 현재 목소리 ID: `e9b134e4c0b547a3894793be502314f1` (Jasphina, 에너지있는 여성). 필요하면 교체.

2. 재생성:
```powershell
$env:FISH_API_KEY = "<키 입력>"
python tools/gen_voices.py --force hero_die
```

3. 전사로 내용 확인:
```bash
python tools/check_voices.py
```

4. 만족스러우면 빌드에 반영.

> **주의:** API 키는 환경변수로만 사용. 코드·파일에 저장 금지.

---

## 수정 후 반드시 해야 할 검증

```bash
# 타입 체크
npx tsc --noEmit

# 프로덕션 빌드 확인
npm run build

# 개발 서버 시작 후 Playwright 봇으로 전체 플레이
npm run dev
node tools/play.mjs full --god       # 전 스테이지 클리어, STUCK 없어야 함
node tools/play.mjs flow             # 사망→컨티뉴→게임오버→타이틀 흐름
node tools/play.mjs diag --god       # 타이틀 팜·카메라·스폰 수치 재측정
node tools/play.mjs deathScarf       # 스카프 수정 확인
```

```bash
# 프로덕션 빌드로도 최종 확인 (vite preview 먼저 실행)
npm run build
npx vite preview --port 4173
node tools/play.mjs full --god --url=http://localhost:4173/
```

### 기준값 (수정 전 측정)

| 항목 | 수정 전 | 목표 |
|---|---|---|
| 타이틀 팜 `avgChangedPx` | 측정됨 | 크게 감소 |
| 카메라 급이동 `njumps` (페이드 제외) | 40+ | 0에 가깝게 |
| 화면 내 스폰 `npops` | 19 | 0 (전투 문맥 없는 스폰) |

---

## 수정 완료 후 해야 할 일

`docs/BUGFIXES.md` 생성 — 각 버그의 원인·수정 내용·검증 결과를 기록.

---

## 중요 파일 위치

```
src/game/danger.ts      ← 새로 생성된 공통 경고 마커 모듈 (groundZone, lane, aimLine, alertBadge)
src/game/bg.ts          ← palm() 함수 (버그 1)
src/game/world.ts       ← updateCamera(), cutCamera() (버그 2)
src/game/player.ts      ← updateScarf() (버그 4, 미완)
src/game/stage.ts       ← 스테이지 배치 / drawTitleBack() (버그 1·2·5)
src/game/vehicles.ts    ← 전차·드레이진·건십 (버그 2·3·5)
src/game/boss.ts        ← 보스 경고 마커 (버그 3)
src/game/props.ts       ← 벙커·MG네스트 (버그 3·5)
src/game/enemies.ts     ← Soldier 총구 연출 / Gyro 폭탄 마커 (버그 3·5)
src/game/decor.ts       ← Building.kickDoor() / rattle (버그 5)
tools/gen_voices.py     ← 보이스 재생성 스크립트 (버그 6)
tools/play.mjs          ← Playwright 테스트 하네스
tools/scenarios.mjs     ← diag / deathScarf / full 시나리오 포함
docs/PROMPT.md          ← 원문 요청 보관
docs/BUGFIXES.md        ← 수정 이력 기록 (아직 미생성)
```

---

## 개발 서버 포트 정리

| 명령 | 포트 |
|---|---|
| `npm run dev` | 5173 |
| `npx vite preview` | 4173 |
| `node tools/play.mjs <시나리오>` | 기본 5173 (dev), `--url=` 로 변경 가능 |
