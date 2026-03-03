---
title: "Flutter는 Material을 떼어내는 중이다"
tags:
  - flutter
  - material
  - cupertino
  - architecture
  - design-system
  - widget
---

## Material이 왜 핵심에 붙어있었나

Flutter를 처음 배우면 대부분 `import 'package:flutter/material.dart'`로 시작한다. `MaterialApp`, `Scaffold`, `AppBar`... 이것들 없이는 화면 하나 못 띄울 것 같다. 실제로 거의 모든 Flutter 튜토리얼이 Material을 기본으로 깔고 시작한다.

이건 우연이 아니라 설계였다. Flutter 초기에 "바로 쓸 수 있는 완성된 UI 키트"를 제공하려고 Material과 Cupertino를 프레임워크 안에 내장했다. 배터리가 포함된 장난감처럼, 상자 열자마자 바로 쓸 수 있게 한 거다.

```
flutter SDK (한 덩어리)
  ├── widgets/     ← 핵심 위젯
  ├── rendering/   ← 렌더링
  ├── material/    ← Material Design (여기 붙어있음)
  └── cupertino/   ← iOS 스타일 (여기도 붙어있음)
```

편리했다. 근데 시간이 지나면서 문제가 드러났다.

---

## 층 사이에 배선이 꼬여있다

[[Flutter 소스코드는 세 층짜리 건물이다|Flutter 프레임워크 내부]]에는 층 구조가 있다. 아래에서 위로:

```
Material / Cupertino  (디자인 시스템)
         ↓ 의존
     Widgets  (핵심 위젯)
         ↓ 의존
    Rendering  (렌더링)
```

규칙은 간단하다. 위층이 아래층만 쓸 수 있다. Material이 Widgets를 쓰는 건 맞지만, Widgets가 Material을 쓰면 안 된다. 건물 2층이 3층 화장실 배관을 끌어다 쓰면 3층을 리모델링할 때 2층이 터지는 것처럼.

근데 실제로는 이게 일어나고 있었다.

### 텍스트 선택 핸들의 딜레마

텍스트를 길게 누르면 선택 핸들(양쪽 끝에 붙은 동그라미)이 나타난다. 이 핸들은 Android에서는 Material 스타일이고 iOS에서는 Cupertino 스타일이어야 한다.

```
Android 텍스트 선택                    iOS 텍스트 선택
  ┌───────────────┐                  ┌───────────────┐
  │ Hello Wo│rld  │                  │ Hello Wo│rld  │
  └────────┘─────┘                   └────────┘─────┘
         ●       ●  ← Material 핸들         |       |  ← Cupertino 핸들
```

문제는 `SelectionArea`가 핵심 Widgets 층에 있다는 거다. 근데 이 위젯이 "지금 Android니까 Material 핸들을 쓰고, iOS면 Cupertino 핸들을 써야지"라는 결정을 하고 있다. 핵심 위젯이 디자인 시스템을 알고 있는 거다.

### AppBar도 같은 문제

`AppBar`라는 이름은 범용적이지만, 실제 구현은 Material Design에 완전히 결합되어 있다. 높이, 그림자, elevation, 색상 전부 Material 스펙을 따른다. Cupertino 스타일 네비게이션바를 원하면 `CupertinoNavigationBar`라는 완전히 다른 위젯을 써야 한다.

```dart
// Material 앱바
AppBar(title: Text('제목'))

// Cupertino 네비게이션바 — 완전 다른 클래스
CupertinoNavigationBar(middle: Text('제목'))
```

"앱바"라는 개념은 같은데(상단에 제목이 있는 바) 디자인 시스템마다 별도 위젯이다. 공통된 "앱바의 뼈대"가 없는 거다.

---

## 안 쓰는 코드도 따라온다

Material을 안 쓰고 순수 Cupertino 앱을 만든다고 치자. 아니면 아예 자체 디자인 시스템을 쓴다고 치자.

```dart
// Cupertino만 쓰는 앱
import 'package:flutter/cupertino.dart';

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return CupertinoApp(
      home: CupertinoPageScaffold(
        child: Center(child: Text('순수 iOS 스타일')),
      ),
    );
  }
}
```

Material은 한 줄도 안 썼다. 근데 핵심 위젯 층이 Material에 의존하고 있으니까, Material 관련 코드가 빌드에 포함된다. 앱 크기가 괜히 커지는 거다.

```
[지금]
너의 앱 코드
  └── flutter/widgets (필수)
        └── material 코드 일부 (안 쓰는데 딸려옴)
        └── cupertino 코드 일부 (안 쓰는데 딸려옴)
```

그리고 또 하나 — Material 2에서 Material 3로 바뀔 때. 이건 디자인 시스템 변경인데, Flutter SDK 버전 업그레이드와 묶여있었다. "성능 개선된 새 Flutter 쓰고 싶은데, Material 3 강제 적용은 아직 준비가 안 됐어" 같은 상황이 생긴다. 디자인 업데이트와 프레임워크 업데이트가 한 몸이라서 따로 선택할 수가 없었다.

---

## 해결책: 뼈대만 남기고 살을 분리한다

Flutter 팀이 선택한 전략은 **"Blank Canvas"**다. 핵심 위젯에서 디자인을 전부 빼고, 순수한 뼈대(구조 + 동작)만 남기는 거다.

```
[지금]                                [앞으로]
AppBar                               RawAppBar (뼈대)
= Material 스타일 고정                  = 구조와 동작만
                                        ├── Material이 감싸면 → Material AppBar
                                        ├── Cupertino가 감싸면 → iOS NavigationBar
                                        └── 직접 감싸면 → 나만의 AppBar
```

비유하면, 지금은 "파란색 페인트가 칠해진 문"을 팔고 있었다. 앞으로는 "칠 안 한 문틀"을 제공하고, 색은 각자 고르게 하는 거다.

### Raw 위젯이란

"Raw" 위젯은 동작은 하지만 디자인 의견이 없는 위젯이다.

```dart
// Raw 위젯 (앞으로 핵심 위젯 층에 들어갈 것)
RawButton(
  onPressed: () {},
  child: child,
  // 모양? 없다. 네가 정해.
)

// Material이 감싸면
MaterialButton(
  // RawButton의 동작 + Material 스타일 (elevation, ripple 효과)
)

// Cupertino가 감싸면
CupertinoButton(
  // RawButton의 동작 + iOS 스타일 (반투명 효과)
)
```

Raw 위젯이 담당하는 것:
- **상태 관리** — 눌림/포커스/호버 상태 추적
- **접근성** — 스크린 리더용 시맨틱 정보
- **제스처** — 탭, 롱프레스 감지
- **키보드 내비게이션** — 탭 순서, 엔터 키 반응

Raw 위젯이 담당하지 않는 것:
- 색상, 그림자, 모서리 둥글기
- 리플 이펙트, 애니메이션 스타일
- 특정 디자인 시스템의 규칙

이렇게 하면 의존 방향이 올바르게 된다:

```
[지금: 역방향 의존 있음]           [앞으로: 한 방향만]
Material ─── 의존 ──▶ Widgets     Material ─── 의존 ──▶ Widgets
             ◀── 의존 ───┘                              (역방향 없음)
```

---

## Material과 Cupertino가 별도 패키지가 된다

최종 목표는 Material과 Cupertino를 Flutter SDK에서 꺼내서 pub.dev의 독립 패키지로 만드는 거다.

```yaml
# 지금의 pubspec.yaml
dependencies:
  flutter:
    sdk: flutter
  # material/cupertino는 SDK에 내장 → 선택권 없음

# 앞으로의 pubspec.yaml
dependencies:
  flutter:
    sdk: flutter
  material: ^1.0.0      # 필요하면 추가
  cupertino: ^1.0.0     # 필요하면 추가
  # fluent_ui: ^5.0.0   # 또는 커뮤니티 디자인 시스템
```

이게 바뀌면 생기는 변화:

```
┌───────────────────────────────────────────────────────────┐
│  변화                    │  왜 좋은가                       │
├───────────────────────────────────────────────────────────┤
│  Material 독립 버전 관리  │  Flutter 업그레이드 없이          │
│                          │  Material 4 바로 적용 가능       │
├───────────────────────────────────────────────────────────┤
│  안 쓰면 안 넣어도 됨     │  앱 크기가 줄어듦                │
├───────────────────────────────────────────────────────────┤
│  커뮤니티 디자인 시스템과  │  Fluent UI, 자체 디자인이        │
│  동등한 지위              │  Material과 동급이 됨            │
├───────────────────────────────────────────────────────────┤
│  코어 팀이 핵심에 집중    │  성능, 렌더링 개선이 빨라짐       │
└───────────────────────────────────────────────────────────┘
```

지금까지 커뮤니티 디자인 시스템(`fluent_ui`, `macos_ui` 등)은 Material이 SDK에 내장된 "1등 시민"인 반면 자기들은 "2등 시민"이었다. 분리되면 모든 디자인 시스템이 동등한 출발선에 서게 된다.

---

## 일정

이건 수년에 걸친 점진적 변화다. 하루아침에 기존 코드가 깨지는 일은 없다.

```
2025년 말
  │  핵심 위젯 강화 — Raw 위젯 추출
  │  기존 코드는 그대로 동작
  │
  ▼
2026년 초
  │  Material/Cupertino를 pub.dev 독립 패키지로 이동
  │  마이그레이션 도구 제공
  │
  ▼
2026년+
     독립적 버전 관리 시대
     Material은 Flutter SDK와 별도로 업데이트
```

"마이그레이션"이라고 해서 겁먹을 필요 없다. Flutter 팀이 자동화 도구를 같이 제공할 예정이고, 단계적으로 진행된다.

---

## 지금부터 준비할 수 있는 것들

아직 분리가 완료되지 않았지만, 지금부터 습관을 바꿔놓으면 나중에 편하다.

### import를 의도적으로 쓰기

```dart
// 나쁜 습관 — 모든 파일에서 material.dart를 import
import 'package:flutter/material.dart';

// 좋은 습관 — 필요한 것만
import 'package:flutter/widgets.dart';      // UI 구조만 필요할 때
import 'package:flutter/foundation.dart';   // 비즈니스 로직에서
import 'package:flutter/material.dart';     // Material 위젯을 쓸 때만
```

대부분의 사람이 `material.dart`를 만능 import처럼 쓴다. `material.dart`가 `widgets.dart`를 re-export하니까 동작은 한다. 근데 이러면 나중에 Material이 분리됐을 때 불필요한 의존이 남는다.

실제로 `StatelessWidget`, `Column`, `Padding`, `Text` 같은 기본 위젯은 전부 `widgets.dart`에 있다. Material 위젯(`AppBar`, `Scaffold`, `ElevatedButton` 등)을 안 쓰는 파일에서는 `widgets.dart`만 import하면 된다.

### adaptive 생성자 대신 명시적 분기

```dart
// 편리하지만 미래에 불안정
Switch.adaptive(value: isOn, onChanged: onChanged)

// 더 안전한 방법
if (Platform.isIOS) {
  return CupertinoSwitch(value: isOn, onChanged: onChanged);
} else {
  return Switch(value: isOn, onChanged: onChanged);
}
```

`.adaptive`는 내부에서 플랫폼 분기를 해주는 편의 기능인데, 핵심 위젯이 디자인 시스템을 아는 바로 그 문제의 산물이다. 분리 이후에는 이런 생성자가 사라지거나 동작이 바뀔 수 있다.

물론 지금 당장 `.adaptive`를 다 걷어내라는 건 아니다. 새로 작성하는 코드에서 습관을 바꿔가면 된다.

### Material 위젯을 상속하지 않기

```dart
// 위험 — Material 내부 구현에 의존
class MyButton extends ElevatedButton {
  // ElevatedButton이 바뀌면 같이 깨짐
}

// 안전 — 기본 프리미티브 조합
class MyButton extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onPressed,
      child: AnimatedContainer(
        duration: Duration(milliseconds: 200),
        decoration: BoxDecoration(
          color: isPressed ? pressedColor : normalColor,
          borderRadius: BorderRadius.circular(8),
        ),
        child: child,
      ),
    );
  }
}
```

`GestureDetector`, `AnimatedContainer`, `DecoratedBox` 같은 건 핵심 위젯 층에 있어서 분리의 영향을 받지 않는다. 이런 프리미티브를 조합하면 어떤 디자인 시스템 변화에도 안전하다.

---

## 큰 그림에서 보면

이 변화는 Flutter가 "구글의 모바일 UI 툴킷"에서 **"범용 렌더링 엔진"**으로 성숙해가는 과정이다.

```
[2018] Flutter = Material Design 모바일 UI 키트
                 (Material이 핵심에 내장)

[2024] Flutter = 6개 플랫폼 지원하는 UI 프레임워크
                 (Material이 내장인 게 부담이 됨)

[2026+] Flutter = 디자인 중립적 렌더링 엔진
                  (Material은 선택 가능한 패키지 중 하나)
```

게임 엔진을 생각해보면 이해가 쉽다. Unity나 Unreal은 렌더링 엔진이지 특정 아트 스타일을 강제하지 않는다. Flutter도 같은 방향으로 가는 거다. 렌더링은 핵심이 하고, 디자인은 각자 선택하는 구조.

---

## 삽질에서 건진 것들

"그럼 `material.dart` 당장 안 써도 되나?" 했는데, 아직 아니다. 지금은 `material.dart`가 핵심 위젯까지 전부 re-export하고 있어서, 이걸 빼면 기본 위젯도 못 쓰게 된다. 분리가 완료된 후에야 진짜 선택이 된다.

`widgets.dart`만 import하고 개발해보니까, 생각보다 Material 위젯 없이 할 수 있는 게 많았다. `Container`, `Column`, `Row`, `Stack`, `Padding`, `Text`, `GestureDetector`만으로 기본 레이아웃은 다 짤 수 있다. [[setState는 Flutter에게 다시 그려달라고 말하는 거다|setState]]도 `widgets.dart`에 있다. Material은 예쁘게 꾸미는 단계에서 얹는 거지 필수가 아니다.

"Cupertino만 쓰면 Material 코드가 안 들어오는 거 아냐?" 했는데, 실제로 빌드 결과를 보면 핵심 위젯이 Material에 의존하는 부분 때문에 Material 코드 일부가 딸려온다. 트리 셰이킹이 만능이 아닌 게, 조건부 import 같은 패턴은 컴파일 시점에 제거가 안 되는 경우가 있기 때문이다. 분리가 완료되면 이런 문제가 원천적으로 사라진다.
