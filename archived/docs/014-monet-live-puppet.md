# 014 — Monet Live Puppet (Silly Crocodile 셋업)

> Jin: "Silly Crocodile 셋업을 Monet으로 재현하자 — 3D rig을 ARKit로 컨트롤.
> 그리고 **내 딸이 직접 조종해서 fun video를 만들** 수 있게."
> 이 문서는 그 셋업의 design spec. `[[012-monetto-body]]` §IV("회화풍으로 살아 움직이는
> 형태 — 리그는 미정")를 닫는 작업. `[[silly-crocodile-lesson]]` 기억대로 이건 *제품*이 아니라
> **charm 퍼널**이다 — reach≠money. 콘텐츠는 깔때기, 제품(정원)은 나중.

## 목표 (1차)

딸이 **아이폰 한 대**로 자기 표정/머리 움직임을 지어 보이면, 화면 속 **Monet이 실시간으로
따라 하며 말하고 반응**하고, 그걸 녹화해 **fun 클립**(IG Reel 후보)으로 뽑는다.
"Silly Crocodile" = 과장된 캐릭터가 라이브로 표정 반응 → 그 매력을 Monet 룩 그대로.

**성공 기준:** 딸이 어른 도움 최소로 (a) 폰에서 Monet을 보고 (b) 표정으로 조종하고
(c) 30초 클립을 녹화해 낸다. 그 클립이 "귀엽다/웃기다" 소리를 듣는다.

## 갈림길에서 내린 결정 (Jin과 확정)

| 결정 | 선택 | 이유 |
|---|---|---|
| 몸 형태 | **2D 페인털리** (3D VRM 아님) | Monet 정체성=회화풍(`012 §IV`). 기존 painted 아트 그대로 살아 움직임. 3D는 룩 깨고 over-engineering(YAGNI). 풀바디/정원 워크 필요해지면 그때 3D 연다. |
| 캡처 장비 | **iPhone ARKit** | TrueDepth 52 blendshape — 입/눈/눈썹/혀까지. 표현력 최고. 키드 직관적(표정 지으면 따라함). |
| 1차 목표 | **콘텐츠 퍼널** | 제품 통합(웹 몸)은 검증 후 Phase 3. |
| 운전자 | **딸 (아이)** | → 단일 기기·저마찰·forgiving UX가 제1제약. 데스크탑 셋업 금지. |

## 도구 스택

```
[iPhone: VTube Studio]
  ARKit 캡처  +  Monet(Live2D) 라이브 렌더  +  화면녹화
        ↑ 단일 기기. 딸이 폰만 보면 Monet이 따라함.
```

- **리깅: Live2D Cubism Editor (무료판)** — 기존 Monet painted 스틸을 레이어 분리 →
  deformer 부착(입 vowel, blink, 눈썹, head yaw/pitch/roll). 무료판 한도(ArtMesh/deformer
  수)는 talking-head 한 캐릭터엔 충분. **Phase 0에서 라이선스 한도/상업이용 약관 체크.**
- **런타임/캡처: VTube Studio (iOS)** — Live2D 모델 import, 아이폰 ARKit 자체 캡처,
  모델 라이브 렌더, iOS 화면녹화로 클립 산출. 데스크탑 불필요.
- **대안(채택 안 함):** Inochi2D — 100% 오픈/무료지만 데스크탑 Creator 중심이라 키드 iOS
  UX가 약함. Live2D 라이선스가 막히면 fallback으로 재검토.

## 에셋 (이미 있음 → 신규 최소)

- 소스 스틸: `contents/monet/monet-angry-large.png`, `monet-brush-large-2.png` 등 정면 PNG.
- **신규 작업:** 정면 Monet 1장을 **레이어 분리**(머리/얼굴/눈L/눈R/입/눈썹/몸/배경).
  - 평면 painted 이미지라 레이어가 없음 → Photoshop/Procreate에서 수동 분리하거나,
    레이어 살린 정면 포트레이트를 **새로 1장 생성**(painting-model 파이프, `006`). 후자가 깔끔.
  - Live2D는 분리된 PNG 레이어(PSD)를 입력으로 받음.

## 단계 (phased — 각 단계가 독립 검증)

**Phase 0 — 파이프 살아있나 (반나절, 코드 0)**
- iPhone에 VTube Studio 설치. **번들 샘플 모델**로 "내 표정 → 캐릭터 입/눈/머리" + 화면녹화
  까지 end-to-end 확인. Live2D 무료판 라이선스/상업이용 약관 확인.
- 산출: "셋업이 작동한다" 확인 + 라이선스 OK/NG.

**Phase 1 — Monet 리깅 (1~2일)**
- 정면 Monet 레이어셋 확보(분리 or 신규 생성).
- Cubism에서 deformer: blink, 입 A/I/U/E/O, 눈썹 up/down, head yaw/pitch/roll, body sway.
- ARKit blendshape(jawOpen, eyeBlink, browDown/Up, headPose) → Live2D param 매핑.
- 산출: VTube Studio에 import 되는 `monet.model3.json` + 부모가 "표정 따라함" 확인.

**Phase 2 — 첫 콘텐츠 + VERDICT (1일)**
- 딸이 퍼펫팅 → Monet talking 30초 클립 녹화. `contents/`에 보관, `docs/013` IG 퍼널과 연결.
- VERDICT 노트(`rhythm-cast-proto/NOTES.md` 패턴):
  - 매력 나오나? 딸이 어른 도움 없이 조종/녹화 되나?
  - reach≠money(`silly-crocodile-lesson`) — 이건 퍼널이지 제품 아님. funnel→정원으로 어떻게 잇나?
  - 입 싱크/표정이 "Monet이 살아있다"로 읽히나, 아니면 mask가 떠보이나?

**Phase 3 — (선택, 검증 후) 웹 통합**
- 매력 확인되면 web-native(R3F/canvas + MediaPipe in-browser, 폰 불필요)로 `/studio`에 얹어
  *제품 몸*으로. 지금은 **안 함** — Phase 2 VERDICT가 go 줄 때만.

## 리스크 / 오픈 이슈

- **Live2D 무료판/VTube Studio 상업이용 약관** — IG 게시가 걸리나? (Phase 0 게이트)
- **레이어 분리 품질** — 평면 painted 아트에서 깔끔히 분리 안 되면 신규 포트레이트 1장 필요.
- **아이 UX** — 폰 거치/조명/얼굴인식이 애한테 안정적인가. 부모 1-탭 녹화 시작 보조 허용.
- **퍼널→제품 단절** — 콘텐츠만 늘고 정원으로 안 이어지는 Silly Crocodile 함정 경계.

## 아닌 것 (scope out)

- 3D 모델링/VRM, 풀바디 모션캡, 웹 통합(Phase 3 전), AI가 Monet을 자율 구동(별 트랙).
  이번엔 **사람(딸)이 조종하는 2D talking puppet 한 캐릭터 + 첫 클립**까지.
