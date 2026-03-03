---
title: "Flutter 소스코드는 세 층짜리 건물이다"
tags:
  - flutter
  - open-source
  - architecture
  - engine
  - impeller
  - monorepo
---

## 레포를 열어보면 뭐가 보이나

Flutter를 쓰면서 "이 위젯 내부는 어떻게 생겼지?", "엔진은 어디에 있지?" 궁금했던 적 있을 거다. GitHub에서 `flutter/flutter`를 열면 수천 개의 파일이 쏟아진다. 어디서부터 봐야 할지 감이 안 잡힌다.

근데 구조를 알고 나면 의외로 단순하다. Flutter 소스코드는 크게 **세 층**으로 나뉘고, 각 층이 하는 일이 명확하다. 건물로 치면 1층이 땅(OS), 2층이 기계실(엔진), 3층이 거주 공간(프레임워크)이다.

이 글은 Flutter 오픈소스 레포지토리의 구조를 위에서 아래로 따라가는 이야기다. "코드가 어디 있는지"뿐 아니라 "왜 이렇게 나눠놨는지"까지.

---

## Flutter 조직에는 레포가 수백 개다

GitHub의 `flutter` 조직에는 레포가 엄청 많다. 전부 알 필요는 없고, 중요한 것만 추리면 이렇다:

```
flutter 조직 (github.com/flutter)
  │
  ├── flutter/flutter       ← 본체. 프레임워크 + 엔진 + CLI
  ├── flutter/packages      ← 공식 플러그인 (camera, webview 등)
  ├── flutter/devtools       ← 성능 프로파일러, 디버거 도구
  ├── flutter/samples        ← 예제 앱 모음
  ├── flutter/website        ← docs.flutter.dev 문서 사이트 소스
  └── flutter/cocoon         ← CI 인프라
```

예전에는 `flutter/engine`이 별도 레포였다. 엔진은 C++로 쓰여있고, 프레임워크는 Dart니까 분리해둔 거였다. 근데 2023~2024년에 엔진이 `flutter/flutter`로 합쳐졌다. 이제 한 레포에서 프레임워크도 고치고 엔진도 고칠 수 있다. 모노레포가 된 거다.

개발자 입장에서 평소에 신경 쓸 레포는 두 개다:
- **flutter/flutter** — 프레임워크 소스를 읽거나, 버그를 추적하거나, 컨트리뷰션할 때
- **flutter/packages** — 공식 플러그인(camera, url_launcher 등)의 소스를 볼 때

---

## flutter/flutter 안을 열어보면

```
flutter/flutter/
  ├── bin/          ← flutter 명령어의 진입점
  ├── packages/     ← 프레임워크 본체 (Dart)
  ├── engine/       ← 엔진 본체 (C++)
  ├── examples/     ← 예제 앱들
  ├── dev/          ← 벤치마크, 테스트 인프라
  └── docs/         ← 아키텍처 문서
```

핵심은 `packages/`와 `engine/` 두 디렉토리다. 이 둘이 Flutter의 양대 축이다. `packages/`가 우리가 매일 쓰는 Dart 프레임워크이고, `engine/`이 그 밑에서 실제로 픽셀을 찍는 C++ 엔진이다.

비유하면 이렇다:

```
packages/ = 식당의 주방 (요리사가 레시피대로 만듦)
engine/   = 가스레인지, 오븐, 냉장고 (주방이 돌아가는 기반 시설)
```

셰프(개발자)가 레시피(`Widget`)를 짜면, 주방 도구(엔진)가 실제로 요리(렌더링)를 한다. 셰프는 가스레인지 내부 구조를 몰라도 요리할 수 있지만, 알면 불 조절을 더 잘할 수 있다.

---

## 세 층 아키텍처 — 건물의 전체 그림

Flutter의 전체 구조를 층으로 그리면 이렇다:

```
┌──────────────────────────────────────────────────┐
│          3층: 프레임워크 (Dart)                     │
│  ┌──────────────────────────────────────────────┐│
│  │  Material / Cupertino  (버튼, 앱바 등 UI)       ││
│  ├──────────────────────────────────────────────┤│
│  │  Widgets  (StatelessWidget, StatefulWidget)  ││
│  ├──────────────────────────────────────────────┤│
│  │  Rendering  (RenderObject, 레이아웃 계산)        ││
│  ├──────────────────────────────────────────────┤│
│  │  Foundation  (애니메이션, 제스처, 페인팅)          ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────┬───────────────┘
                                   │ dart:ui (API 경계)
┌──────────────────────────────────▼───────────────┐
│          2층: 엔진 (C++)                          │
│  ├── Impeller / Skia  (GPU 렌더링)                │
│  ├── Dart 런타임  (VM, AOT 컴파일)                  │
│  ├── 텍스트 레이아웃  (글자 배치, 줄바꿈)               │
│  └── Display List  (그리기 명령 기록)               │
└──────────────────────────────────┬───────────────┘
                                   │ C ABI (안정된 인터페이스)
┌──────────────────────────────────▼───────────────┐
│          1층: 플랫폼 임베더 (네이티브)               │
│  ├── Android  (Java/Kotlin)                      │
│  ├── iOS / macOS  (Swift/ObjC)                   │
│  ├── Windows  (C++)                              │
│  ├── Linux  (C++)                                │
│  └── Web  (JS/WebAssembly)                       │
└──────────────────────────────────┬───────────────┘
                                   │
                            운영체제 / 브라우저
```

각 층은 아래층만 의존한다. 위층을 모른다. 이게 핵심 설계 원칙이다.

- **3층 프레임워크**는 `dart:ui` API를 통해 2층 엔진을 호출한다. 엔진이 Metal을 쓰든 Vulkan을 쓰든 신경 안 쓴다.
- **2층 엔진**은 C ABI(`embedder.h` 헤더 파일 하나)를 통해 1층 임베더와 연결된다. 임베더가 안드로이드든 iOS든 신경 안 쓴다.
- **1층 임베더**는 OS가 제공하는 창, 입력, 생명주기를 엔진에 전달해준다.

결과적으로 Flutter가 6개 플랫폼을 지원하는 비결은 **임베더만 새로 짜면 된다**는 거다. 프레임워크와 엔진은 그대로 두고, 각 OS에 맞는 임베더만 구현하면 끝.

---

## 3층: packages/ — 우리가 매일 쓰는 프레임워크

`packages/` 안에는 9개 패키지가 있다:

```
packages/
  ├── flutter/                  ← 프레임워크 본체 (이게 핵심)
  ├── flutter_test/             ← 위젯 테스트 도구 (testWidgets, pump)
  ├── flutter_tools/            ← flutter CLI 구현체
  ├── flutter_driver/           ← 통합 테스트 드라이버 (레거시)
  ├── flutter_localizations/    ← 다국어 지원
  ├── flutter_web_plugins/      ← 웹 플러그인 인프라
  ├── flutter_goldens/          ← 골든 파일 테스트
  ├── integration_test/         ← 통합 테스트 (현재 권장)
  └── fuchsia_remote_debug_protocol/
```

이 중 가장 중요한 건 당연히 `packages/flutter/`다. 이 안에 `StatelessWidget`, `Scaffold`, `Navigator` 같은 우리가 쓰는 모든 것이 들어있다.

### packages/flutter/ 내부 — 프레임워크의 층 구조

이 디렉토리 안에서도 층이 나뉜다. 아래에서 위로:

```
packages/flutter/lib/src/
  │
  ├── foundation/    ← 가장 아래. 기본 유틸, ChangeNotifier, 진단
  ├── animation/     ← Tween, AnimationController, Curves
  ├── painting/      ← TextStyle, BoxDecoration, EdgeInsets
  ├── gestures/      ← 탭, 드래그, 스케일 인식
  ├── semantics/     ← 접근성 (스크린 리더용)
  ├── scheduler/     ← 프레임 스케줄링, Ticker
  ├── services/      ← 플랫폼 채널, 클립보드, 키보드 입력
  │
  ├── rendering/     ← RenderObject, 레이아웃 프로토콜
  ├── widgets/       ← Widget, Element, BuildContext, Navigator
  │
  ├── material/      ← Material Design 위젯들
  └── cupertino/     ← iOS 스타일 위젯들
```

**규칙: 각 디렉토리는 자기보다 아래에 있는 디렉토리만 import할 수 있다.** `material/`은 `widgets/`를 쓸 수 있지만, `widgets/`는 `material/`을 쓸 수 없다. 그래서 `Scaffold`를 안 쓰고 순수 Widget만으로 앱을 만들 수도 있다. Material은 선택이지 강제가 아님.

이걸 알면 소스코드가 수월해진다. "이 위젯의 레이아웃이 어떻게 동작하지?" → `rendering/` 봐라. "제스처 인식 로직은?" → `gestures/` 봐라. "애니메이션 커브 계산은?" → `animation/` 봐라.

### 실전: 소스코드 타고 들어가기

`ElevatedButton`이 눌렸을 때 내부에서 뭐가 일어나는지 궁금하다면?

```
material/elevated_button.dart    ← ElevatedButton 정의
  └── material/button_style_button.dart  ← 공통 버튼 로직
        └── widgets/framework.dart  ← StatefulWidget, build 메커니즘
              └── rendering/box.dart  ← RenderBox, 크기 계산
                    └── rendering/object.dart  ← RenderObject 기본 클래스
```

IDE에서 Ctrl+Click으로 따라가면 이 경로가 보인다. 프레임워크의 층을 위에서 아래로 타고 내려가는 거다.

### flutter_test — 테스트 도구들

[[pumpWidget은 위젯을 심는 거고, pump는 시간을 돌리는 거다|pumpWidget, pump]] 같은 테스트 도구가 여기 들어있다. `testWidgets()`, `WidgetTester`, `find`, 골든 파일 비교 등.

### flutter_tools — CLI의 정체

터미널에서 `flutter run`을 치면 실행되는 코드가 여기 있다. 핫 리로드 구현, 빌드 시스템, 디바이스 관리 전부 Dart로 작성되어 있다.

---

## 2층: engine/ — 픽셀을 찍는 기계실

엔진은 C++로 작성된 Flutter의 심장부다. 우리 눈에 안 보이지만 모든 프레임을 실제로 그리는 건 여기다.

```
engine/src/flutter/
  │
  ├── lib/ui/          ← dart:ui 구현 (프레임워크와의 접점)
  │
  ├── impeller/        ← GPU 렌더러 (Metal, Vulkan, OpenGL)
  ├── display_list/    ← 그리기 명령을 녹화하는 레코더
  ├── flow/            ← 레이어 합성
  ├── txt/             ← 텍스트 레이아웃 (글자 배치, 줄바꿈)
  │
  ├── fml/             ← C++ 기본 라이브러리 (스레드, 메시지 루프)
  ├── runtime/         ← Dart VM 통합
  │
  └── shell/
      └── platform/    ← 플랫폼별 임베더
          ├── android/
          ├── darwin/   ← iOS + macOS
          ├── windows/
          ├── linux/
          └── embedder/ ← 범용 임베더 API (embedder.h)
```

### dart:ui — 프레임워크와 엔진의 국경

`engine/src/flutter/lib/ui/`에 `dart:ui` 라이브러리가 있다. 이게 프레임워크와 엔진 사이의 다리다.

```dart
// 프레임워크가 엔진에 "이거 그려줘"라고 말하는 방법
final recorder = PictureRecorder();
final canvas = Canvas(recorder);
canvas.drawRect(rect, paint);       // ← 이 호출이 엔진의 C++ 코드로 넘어감
final picture = recorder.endRecording();
```

`Canvas`, `Paint`, `Path`, `Scene`, `PlatformDispatcher` 같은 클래스가 여기 정의되어 있다. Flutter 프레임워크는 이것들만 호출하면 되고, 그 뒤에서 Impeller가 Metal로 그리든 Vulkan으로 그리든 알 바 아님. 이 추상화 덕분에 엔진 렌더러를 통째로 교체해도(Skia → Impeller) 프레임워크 코드는 한 줄도 안 바꿔도 됐다.

### Impeller — 새 렌더링 엔진

Flutter는 원래 Skia라는 구글의 2D 그래픽 라이브러리를 썼다. Chrome, Android에서도 쓰는 검증된 라이브러리다. 근데 Skia는 셰이더를 런타임에 컴파일한다. 앱 실행 중에 "이 그래픽 효과 처음 보네, 셰이더 컴파일해야지"가 일어남. 이게 **셰이더 jank** — 프레임이 뚝뚝 끊기는 원인이었다.

Impeller는 이 문제를 해결하려고 만들어졌다. 핵심 아이디어: **셰이더를 빌드 시점에 미리 컴파일해둔다.**

```
[Skia 방식]
앱 실행 중 → 새로운 효과 만남 → 셰이더 컴파일 (여기서 끊김!) → 렌더링

[Impeller 방식]
빌드 시점 → 셰이더 전부 미리 컴파일 → 바이너리에 포함
앱 실행 중 → 미리 컴파일된 셰이더 바로 사용 → 끊김 없음
```

Impeller의 셰이더 컴파일 과정:

```
GLSL 4.60 (저자가 작성)
     │
     ▼
  impellerc (오프라인 컴파일러)
     │
     ├──▶ Metal Shading Language  (iOS/macOS용)
     ├──▶ Vulkan SPIRV           (Android/데스크톱용)
     └──▶ GLSL ES                (구형 기기 폴백)
```

6단계를 전부 빌드 시점에 끝낸다. 런타임에 셰이더 컴파일이 일어나지 않는다. 그래서 첫 프레임부터 매끄럽다. iOS에서는 이미 Impeller가 기본이고, Android에서도 기본이 됐다.

### Display List — 그리기 명령의 녹음기

프레임워크가 `canvas.drawRect()`, `canvas.drawCircle()`을 호출하면, 이 명령들이 바로 GPU로 가는 게 아니다. **Display List**에 기록된다. 녹음기처럼.

```
프레임워크: canvas.drawRect(...)    ──▶  Display List에 기록
프레임워크: canvas.drawText(...)    ──▶  Display List에 기록
프레임워크: canvas.drawImage(...)   ──▶  Display List에 기록
                                         │
                                         ▼
                                    Impeller가 한 번에 실행
                                    (GPU에 배치로 전송)
```

왜 중간에 녹음 단계를 두냐면 — 최적화 기회가 생기니까. 같은 종류의 드로우 콜을 모아서 한 번에 보내거나, 화면 밖에 있는 건 아예 건너뛸 수 있다.

---

## 1층: 임베더 — OS와 마주하는 곳

임베더는 Flutter 엔진을 각 운영체제에 심어주는 코드다. `engine/src/flutter/shell/platform/` 아래에 플랫폼별로 나뉘어 있다.

임베더가 하는 일:

```
┌─────────────────────────────────────────────────┐
│  임베더의 역할                                     │
├─────────────────────────────────────────────────┤
│  1. 앱 창(window/surface)을 만들어서 엔진에 전달    │
│  2. 터치/마우스 입력을 받아서 엔진에 전달            │
│  3. 앱 생명주기(포그라운드/백그라운드)를 엔진에 알림   │
│  4. 렌더링용 스레드를 만들어서 엔진에 제공            │
│  5. 접근성(Accessibility) 정보를 OS에 전달          │
│  6. 플랫폼 채널로 Dart ↔ 네이티브 메시지 중계       │
└─────────────────────────────────────────────────┘
```

재미있는 점은, 엔진이 임베더에 노출하는 인터페이스가 **C 헤더 파일 하나**(`embedder.h`)라는 거다. 이 파일 하나만 구현하면 어떤 플랫폼이든 Flutter를 올릴 수 있다. 실제로 이걸 이용해서 Flutter를 라즈베리 파이, 자동차 인포테인먼트 시스템, 임베디드 기기에 올리는 프로젝트들이 있다.

### 플랫폼 채널 — Dart와 네이티브가 대화하는 방법

카메라를 켜거나, 파일 시스템에 접근하거나, GPS를 읽으려면 OS의 네이티브 API를 불러야 한다. Dart 코드에서 네이티브 코드를 호출하는 경로:

```
Dart                   엔진                    네이티브
┌────────────┐    ┌──────────────┐    ┌──────────────────┐
│MethodChannel│──▶│ Binary       │──▶│ Java/Kotlin      │
│.invokeMethod│    │ Messenger    │    │ Swift/ObjC       │
│('getPhoto') │    │ (직렬화)     │    │ (카메라 API 호출)  │
└────────────┘    └──────────────┘    └──────────────────┘
       │                                       │
       └──────── 결과가 역방향으로 돌아옴 ─────────┘
```

이 구조를 알면 플러그인이 왜 그렇게 생겼는지 이해된다.

---

## flutter/packages — 공식 플러그인이 사는 곳

`flutter/flutter`와 별개로 `flutter/packages` 레포가 있다. 여기에 Flutter 팀이 관리하는 44개 이상의 패키지가 들어있다.

```
flutter/packages/packages/
  ├── camera/              ← 카메라
  ├── url_launcher/        ← URL 열기
  ├── webview_flutter/     ← 웹뷰
  ├── shared_preferences/  ← 간단한 키-값 저장
  ├── path_provider/       ← 파일 경로
  ├── image_picker/        ← 사진/동영상 선택
  ├── video_player/        ← 동영상 재생
  ├── go_router/           ← 선언형 라우팅
  ├── local_auth/          ← 생체 인증
  ├── in_app_purchase/     ← 인앱결제
  ├── google_maps_flutter/ ← 구글 맵
  └── ... (40개 이상)
```

### Federated Plugin — 플러그인이 쪼개져 있는 이유

플러그인을 열어보면 폴더가 5~6개씩 있어서 당황할 수 있다. 이건 **Federated Plugin** 구조 때문이다.

```
camera/
  ├── camera/                            ← 개발자가 import하는 패키지
  ├── camera_platform_interface/         ← 추상 인터페이스
  ├── camera_android/                    ← Android 구현
  ├── camera_avfoundation/               ← iOS/macOS 구현
  └── camera_web/                        ← Web 구현
```

왜 이렇게 나눴을까? 비유하면 이렇다:

```
camera (앱 패키지)
  = "카메라 좀 켜줘"라고 말하는 리모컨

camera_platform_interface
  = "켜기, 끄기, 촬영" 버튼이 뭐가 있는지 정의한 설명서

camera_android, camera_avfoundation, camera_web
  = 각 플랫폼에서 실제로 카메라를 조작하는 기계
```

개발자는 `camera` 패키지만 import한다. 빌드할 때 플랫폼에 맞는 구현이 자동으로 연결됨. 새 플랫폼(예: Tizen)을 지원하고 싶으면 `camera_tizen`만 만들면 된다. 기존 코드를 건드릴 필요 없음.

이 패턴은 flutter/packages의 거의 모든 플러그인에 적용되어 있다. [[Flutter 인앱결제 구현|인앱결제]]도 `in_app_purchase` + `in_app_purchase_storekit`(iOS) + `in_app_purchase_android`로 나뉘어 있다.

---

## 프레임이 그려지는 전체 여정

[[setState는 Flutter에게 다시 그려달라고 말하는 거다|setState]]를 호출하면 화면이 갱신된다고 했다. 그 여정을 세 층 전부를 거쳐서 따라가보자.

```
1. setState() 호출                             [3층 프레임워크]
     │
2. 위젯을 dirty로 표시
     │
3. 다음 프레임 시작 (SchedulerBinding이 엔진에서 콜백 받음)
     │
4. Build: dirty 위젯의 build() 실행, 새 위젯 트리 생성
     │
5. Layout: RenderObject가 크기와 위치 계산
     │
6. Paint: RenderObject가 Canvas에 그리기 명령 기록
     │
7. Composite: Scene을 만들어 dart:ui로 전달
     │
─────────── dart:ui 경계 ───────────────────
     │                                      [2층 엔진]
8. Display List에 그리기 명령 기록
     │
9. Layer Tree 합성 (flow/)
     │
10. Impeller가 GPU 명령으로 변환
     │
─────────── C ABI 경계 ─────────────────────
     │                                      [1층 임베더]
11. 플랫폼이 렌더링된 텍스처를 화면에 표시
```

11단계인데, 이 전체가 16ms(60fps) 안에 끝나야 한다. 그래서 Flutter가 이렇게 층을 나눠서 각 층이 자기 일만 최적으로 하도록 설계한 거다.

---

## Binding 체인 — 프레임워크가 엔진에 연결되는 방법

앱이 시작할 때 `runApp()`을 호출하면, 내부에서 `WidgetsFlutterBinding`이라는 게 만들어진다. 이 녀석이 프레임워크의 모든 것을 엔진에 연결하는 접착제다.

```dart
// 이 한 줄이
runApp(MyApp());

// 내부에서 이걸 한다
WidgetsFlutterBinding.ensureInitialized();
```

`WidgetsFlutterBinding`은 여러 `Binding` 믹스인을 합친 거다:

```
WidgetsFlutterBinding
  ├── WidgetsBinding       ← Element 트리 관리, runApp
  ├── RendererBinding      ← RenderView, 렌더링 파이프라인
  ├── SemanticsBinding     ← 접근성
  ├── PaintingBinding      ← 이미지 디코딩
  ├── ServicesBinding       ← 플랫폼 채널, 에셋 번들
  ├── SchedulerBinding     ← 프레임 스케줄링 (엔진의 콜백 수신)
  └── GestureBinding       ← 포인터 이벤트 라우팅
```

`SchedulerBinding`이 `dart:ui.PlatformDispatcher.onBeginFrame`과 `onDrawFrame`에 콜백을 등록한다. 엔진이 "프레임 시작이야"라고 알려주면, 이 콜백이 실행되면서 Build → Layout → Paint가 돌아가는 거다.

---

## 소스코드 찾기 치트시트

뭘 찾고 싶은지에 따라 어디를 봐야 하는지:

```
┌──────────────────────────────────┬────────────────────────────────────┐
│ 찾고 싶은 것                      │ 어디를 보나                         │
├──────────────────────────────────┼────────────────────────────────────┤
│ Scaffold, AppBar 구현            │ packages/flutter/lib/src/material/ │
│ Widget, Element, BuildContext    │ packages/flutter/lib/src/widgets/  │
│ RenderObject, 레이아웃 로직       │ packages/flutter/lib/src/rendering/│
│ 애니메이션, Tween, Curves        │ packages/flutter/lib/src/animation/│
│ 제스처 인식                       │ packages/flutter/lib/src/gestures/ │
│ dart:ui (프레임워크-엔진 경계)     │ engine/src/flutter/lib/ui/         │
│ Impeller 렌더러                  │ engine/src/flutter/impeller/        │
│ Android 임베더                   │ engine/src/flutter/shell/platform/android/ │
│ iOS 임베더                       │ engine/src/flutter/shell/platform/darwin/  │
│ flutter CLI 도구                 │ packages/flutter_tools/             │
│ 위젯 테스트 도구 (pump 등)        │ packages/flutter_test/              │
│ camera, webview 등 플러그인       │ flutter/packages 레포의 packages/   │
└──────────────────────────────────┴────────────────────────────────────┘
```

---

## 실전에서 이걸 어떻게 쓰나

**버그를 만났을 때** — 에러 스택트레이스에 `packages/flutter/lib/src/rendering/` 경로가 보이면, 렌더링 층에서 문제가 생긴 거다. 레이아웃 오버플로우 같은 거. `material/` 경로가 보이면 Material 위젯 사용법 문제다. 어느 층에서 터졌는지 알면 구글링 키워드가 달라진다.

**성능을 튜닝할 때** — DevTools에서 "Build" 시간이 길다면 `widgets/` 층 문제다. 불필요한 리빌드를 줄여야 함. "Paint" 시간이 길면 `rendering/` 층이고, 복잡한 그래픽을 단순화해야 한다. "Raster" 시간이 길면 엔진 층이고, 셰이더 복잡도나 이미지 크기를 줄여야 한다.

**오픈소스 기여할 때** — 프레임워크 버그는 Dart만 알면 고칠 수 있다. 대부분의 이슈는 `packages/flutter/` 안에서 해결된다. 엔진 쪽은 C++ 빌드 환경 세팅이 필요해서 진입 장벽이 높지만, 임베더 쪽은 Java/Swift 경험이 있으면 접근 가능하다.

**위젯 동작이 궁금할 때** — IDE에서 Ctrl+Click(또는 Cmd+Click)으로 위젯 소스를 열면 `packages/flutter/lib/src/` 안의 코드가 보인다. Flutter SDK를 설치하면 이 소스가 로컬에 이미 있다. 공식 문서보다 소스가 정확할 때가 많다.

---

## 삽질에서 건진 것들

Flutter 소스를 처음 봤을 때 `Widget`, `Element`, `RenderObject`가 셋 다 따로 있어서 혼란스러웠다. 근데 구조를 이해하니까 명확해졌다. Widget은 설정(레시피), Element는 인스턴스(실제 요리), RenderObject는 화면에 그리는 책임자(서빙). 세 가지가 각자의 역할이 있고, 세 개의 트리가 병렬로 존재한다.

`flutter/engine` 레포를 클론받아서 빌드하려다 삽질한 적이 있다. 알고 보니 엔진이 `flutter/flutter`로 합쳐진 뒤여서 옛날 레포는 아카이브 상태였다. 모노레포 전환 이후에는 `flutter/flutter` 하나만 클론하면 된다.

플러그인 소스를 보려고 `flutter/flutter` 안을 뒤졌는데 없었다. camera, webview 같은 플러그인은 `flutter/packages`라는 별도 레포에 있다. 이름이 비슷해서 헷갈리는데, `flutter/flutter`의 `packages/`는 프레임워크 핵심이고, `flutter/packages`는 플러그인 모음이다.

Impeller가 뭔지 몰라서 "Skia 대체품"으로만 이해했었는데, 핵심은 "셰이더를 미리 컴파일한다"는 한 문장이었다. 이걸 알고 나니 왜 iOS에서 셰이더 jank가 사라졌는지, 왜 첫 프레임이 빨라졌는지 이해됐다.
