---
title: "두 패키지를 동시에 바꿔야 할 때 벌어지는 닭과 달걀문제"
tags:
  - flutter
  - svg
  - open-source
  - multi-package
  - ci-pipeline
  - widget-pattern
---

> 하나의 기능이 두 패키지에 걸쳐 있을 때 오픈소스에 기여하는 과정. cross-package 의존성 때문에 CI가 깨지는 구조적 문제와, PR을 분리해서 해결하는 전략.

---

## 성공 상태에서만 위젯을 꾸밀 방법이 없었다

비동기로 리소스를 로딩하는 위젯이라면 보통 세 가지 상태가 있다: 로딩 중, 실패, 성공. 로딩 중에는 `placeholderBuilder`, 실패에는 `errorBuilder`로 각각 커스텀할 수 있었다. 그런데 성공 상태에서 결과 위젯을 감쌀 방법이 없었다.

예를 들어 네트워크에서 이미지를 불러와서 테두리를 주고 싶다면:

```dart
Container(
  decoration: BoxDecoration(border: Border.all(color: Colors.blue)),
  child: SomeAsyncImageWidget.network('https://example.com/image.svg',
    placeholderBuilder: (_) => CircularProgressIndicator(),
  ),
)
```

이러면 로딩 중에도, 실패 시에도 테두리가 보인다. 성공했을 때만 테두리를 보여주려면 성공 상태를 감지할 builder가 필요하다. 이것이 `imageBuilder`다.

```dart
SomeAsyncImageWidget.network('url',
  placeholderBuilder: (_) => CircularProgressIndicator(),
  imageBuilder: (context, child) => Container(
    decoration: BoxDecoration(border: Border.all(color: Colors.blue)),
    child: child,  // child = 성공적으로 로딩된 이미지 위젯
  ),
)
```

간단한 기능이다. 하지만 이걸 구현하려면 두 패키지를 동시에 건드려야 했다.

---

## 겉은 인터페이스 위젯인데 속은 다른 패키지의 엔진이다

이 SVG 라이브러리의 아키텍처는 2-패키지 구조로 되어 있다:

```
flutter_svg (사용자 인터페이스)        vector_graphics (렌더링 엔진)
─────────────────────────          ──────────────────────────────
SvgPicture (StatelessWidget)       VectorGraphic (StatefulWidget)
  └─ "어디서 SVG를 가져올지"           └─ "어떻게 그릴지"
  └─ 자체 로직 없음                    └─ 로딩, 캐싱, 렌더링 전부
```

`SvgPicture`는 껍데기다. `build()` 메서드에서 모든 파라미터를 `VectorGraphic`에 그대로 넘기고 끝이다. 실제 로딩과 렌더링은 전부 `VectorGraphic`의 State에서 일어난다.

그래서 `imageBuilder`를 추가하려면:
1. **vector_graphics**에 `imageBuilder` 파라미터와 적용 로직을 추가하고
2. **flutter_svg**에서 이 파라미터를 사용자에게 노출해야 한다

---

## private 생성자에 접근하려면 같은 파일에 다리를 놓아야 한다

`VectorGraphic` 위젯에는 생성자가 2개 있다:

```dart
const VectorGraphic({...})   : strategy = RenderingStrategy.raster;   // 공개
const VectorGraphic._({...}) : strategy = RenderingStrategy.picture;  // private
```

기본 렌더링 전략이 다르다. 공개 생성자는 raster(성능 우선), private 생성자는 picture(호환성 우선). `flutter_svg`는 picture 전략이 기본이어야 해서 private 생성자를 써야 한다. 공개 생성자를 쓰면 기존 사용자 전원이 갑자기 raster로 바뀌는 breaking change가 된다.

Dart에서 `_`가 붙은 멤버는 **같은 라이브러리(같은 파일) 안에서만** 접근 가능하다. 다른 패키지인 `flutter_svg`에서는 절대 호출할 수 없다. 그래서 같은 파일에 공개 함수를 하나 만들어서 다리 역할을 시킨다:

```
flutter_svg (다른 패키지)
  └─ SvgPicture.build()
       └─ createCompatVectorGraphic()  ← 공개 함수라 접근 가능
            └─ VectorGraphic._()       ← 같은 파일이니까 접근 가능
```

이 브릿지 함수에도 `imageBuilder` 파라미터를 추가해야 한다.

---

## build() 안의 3줄이 이 기능의 전부다

`VectorGraphic`의 `build()` 메서드 안에서, 성공 분기의 위젯 트리는 이런 구조다:

```
Semantics (접근성)
  └─ AnimatedSwitcher (전환 애니메이션, 선택적)
       └─ ★ imageBuilder (여기에 추가)
            └─ SizedBox (사용자 지정 크기)
                 └─ FittedBox (스케일/정렬)
                      └─ SizedBox.fromSize (원본 크기)
                           └─ 렌더 위젯 (실제 SVG 그리기)
```

추가한 코드:

```dart
// SizedBox/FittedBox 래핑 후, Semantics 래핑 전
if (widget.imageBuilder != null) {
  child = widget.imageBuilder!(context, child);
}
```

이 위치가 중요하다:
- **SizedBox/FittedBox 뒤**: SVG가 올바른 크기로 렌더링된 후에 감싸야 한다
- **성공 분기 안에서만 실행**: 에러/로딩 상태에서는 호출되지 않는다
- **Semantics 래핑 전**: 접근성 정보는 전체 위젯을 감싸야 하므로 가장 바깥에 있어야 한다

optional parameter이므로 기존 사용자 코드에 영향이 없다. null이면 기존과 동일하게 동작한다.

---

## 하나의 PR로 두 패키지를 고치면 CI가 깨진다

처음에는 `vector_graphics`와 `flutter_svg` 변경을 하나의 PR에 담았다. CI가 계속 실패했다. 원인은 cross-package 의존성 문제다.

```
flutter_svg의 pubspec.yaml:
  vector_graphics: ^1.1.13   ← pub.dev에서 가져옴
```

CI의 `dart analyze`는 `flutter_svg` 코드를 분석할 때 pub.dev에서 최신 `vector_graphics`를 가져온다. 하지만 pub.dev 버전에는 아직 `imageBuilder`가 없다. PR에서 추가한 코드가 pub.dev에는 반영되지 않았으니까.

```
문제 구조:

flutter_svg 코드:  imageBuilder 타입을 참조
    ↓ depends on
vector_graphics (pub.dev): imageBuilder 타입이 없음
    ↓
dart analyze 실패!
```

CI에 `analyze - pathified`라는 단계가 있어서 로컬 경로 기반으로 분석하지만, 그 전에 실행되는 일반 `analyze`가 먼저 실패해서 전체 job이 터진다.

---

## PR을 둘로 쪼개면 닭과 달걀이 풀린다

이건 mono-repo에서 여러 패키지를 관리할 때 흔한 패턴이다:

```
PR #1: vector_graphics만 변경
  → imageBuilder API 추가 + 버전 범프
  → 머지 후 pub.dev에 퍼블리시

PR #2: flutter_svg만 변경 (퍼블리시 후)
  → SvgPicture에 imageBuilder 파라미터 추가
  → vector_graphics: ^새버전 (pub.dev에 이미 있음)
  → dart analyze 통과!
```

이 repo의 CI 검증 항목:

| CI 체크 | 검증 내용 |
|---|---|
| `version-check` | 코드 변경 시 CHANGELOG + 버전 범프 필수 |
| `analyze` (일반) | pub.dev 의존성 기준 정적 분석 |
| `analyze - pathified` | 로컬 경로 기반 cross-package 분석 |
| `dart_unit_test` | `flutter test` 실행 |

`version-check`에서 `lib/` 파일이 바뀌면 반드시 pubspec.yaml의 version을 올리고 CHANGELOG에 항목을 추가해야 한다. `## NEXT` 섹션에 쓰는 것만으로는 부족하다.

---

## 테스트는 상태 전환의 타이밍을 증명한다

비동기 위젯 테스트의 핵심은 **로딩 타이밍을 수동으로 제어**하는 것이다.

### 성공 시 호출되는가

즉시 데이터를 반환하는 테스트 Loader를 사용한다. `pumpAndSettle()` 후 `imageBuilder`가 반환한 위젯이 트리에 존재하는지 확인:

```dart
testWidgets('imageBuilder wraps the loaded graphic', (tester) async {
  await tester.pumpWidget(
    VectorGraphic(
      loader: TestBytesLoader(data),  // 즉시 반환
      imageBuilder: (context, child) => Container(
        key: const ValueKey('image-builder'),
        child: child,
      ),
    ),
  );
  await tester.pumpAndSettle();

  expect(find.byKey(const ValueKey('image-builder')), findsOneWidget);
});
```

### 로딩 중에는 호출되지 않는가

`Completer`로 Future의 완료 시점을 수동 제어한다. complete() 전에는 로딩 상태, 후에는 성공 상태:

```dart
testWidgets('imageBuilder is not called during loading', (tester) async {
  final completer = Completer<ByteData>();  // 아직 미완료

  await tester.pumpWidget(
    VectorGraphic(
      loader: DelayedBytesLoader(completer.future),
      imageBuilder: (c, child) => Container(key: ValueKey('image'), child: child),
      placeholderBuilder: (c) => Container(key: ValueKey('placeholder')),
    ),
  );

  // 로딩 중: placeholder만 보임
  expect(find.byKey(ValueKey('placeholder')), findsOneWidget);
  expect(find.byKey(ValueKey('image')), findsNothing);

  // 로딩 완료
  completer.complete(someByteData);
  await tester.pumpAndSettle();

  // 성공 후: imageBuilder만 보임
  expect(find.byKey(ValueKey('image')), findsOneWidget);
  expect(find.byKey(ValueKey('placeholder')), findsNothing);
});
```

이 패턴은 비동기 위젯 테스트에서 범용으로 쓸 수 있다. `Completer`로 비동기 타이밍을 제어하고, `pumpAndSettle()` 전후로 상태 전환을 검증한다.

---

## 삽질에서 배운 것들

### mono-repo에서 cross-package 기능을 추가할 때

PR을 나눌 수밖에 없는 구조적 이유를 이해해야 한다. CI가 pub.dev 기준으로 의존성을 해석하기 때문에, 아직 퍼블리시되지 않은 API를 참조하면 무조건 실패한다. "로컬에서는 되는데 CI에서 안 된다"는 대부분 이 문제다.

### private 생성자를 쓰는 이유가 있다

패키지 설계에서 public과 private 생성자의 기본값이 다른 건 의도적이다. 사용자 직접 사용과 내부 패키지 경유의 최적 기본값이 다르기 때문이다. 기존 public API를 함부로 바꾸면 downstream 사용자 전체에 영향이 간다.

### 위젯 트리에서 빌더를 끼워넣는 위치가 중요하다

같은 builder라도 SizedBox 전에 넣으면 크기 계산에 영향을 주고, Semantics 뒤에 넣으면 접근성 정보가 builder 안쪽만 커버한다. 기존 위젯 트리의 각 레이어가 어떤 역할을 하는지 파악한 후에 위치를 정해야 한다.

---

## 참고

- [Flutter 이슈 #182635](https://github.com/flutter/flutter/issues/182635)
- [vector_graphics PR #11094](https://github.com/flutter/packages/pull/11094)
