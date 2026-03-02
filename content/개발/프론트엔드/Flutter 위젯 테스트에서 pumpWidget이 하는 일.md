---
title: "pumpWidget은 위젯을 심는 거고, pump는 시간을 돌리는 거다"
tags:
  - flutter
  - widget-test
  - pump
  - async
  - animation
  - completer
---

## 진짜 화면에 그리는 게 아니다

Flutter 위젯 테스트는 실제 기기나 에뮬레이터에서 돌아가는 게 아니다. 눈에 보이는 화면 없이, 메모리 안에서 위젯 트리를 만들고 검증하는 거다. 그래서 엄청 빠름. 수백 개 테스트를 몇 초 만에 돌릴 수 있다.

근데 문제가 하나 있다. 실제 앱에서는 `runApp()` 호출하면 Flutter 엔진이 알아서 프레임을 계속 그려준다. 1초에 60번, 매번 build → layout → paint를 반복함. 근데 테스트에서는 이 자동 루프가 없다. 테스트 코드가 직접 "지금 프레임 하나 그려" 하고 명령해야 한다.

이 명령이 `pump`다.

---

## pumpWidget — 위젯을 심는다

`pumpWidget()`은 테스트의 시작점이다. "이 위젯을 화면에 올려놓고 첫 프레임을 그려라"라는 뜻.

```dart
testWidgets('텍스트가 보인다', (tester) async {
  await tester.pumpWidget(
    MaterialApp(home: Text('안녕')),
  );

  expect(find.text('안녕'), findsOneWidget);
});
```

`pumpWidget()`이 하는 일을 순서대로 보면:

```
1. 기존 위젯 트리가 있으면 전부 날린다
2. 전달받은 위젯으로 새 트리를 만든다
3. 프레임 하나를 그린다 (build → layout → paint)
```

1번이 중요하다. `pumpWidget()`을 두 번 호출하면 첫 번째 트리는 완전히 폐기되고 새 트리가 올라감. 그래서 한 테스트 안에서 `pumpWidget()`을 여러 번 호출하면 완전히 새로운 앱이 뜨는 것과 같다.

---

## pump — 시간을 한 칸 앞으로 돌린다

`pumpWidget()`으로 위젯을 심은 다음에는 `pump()`로 시간을 조작한다.

```dart
await tester.pump();                          // 프레임 하나만 그려
await tester.pump(Duration(milliseconds: 500));  // 500ms 앞으로 감고 프레임 그려
```

인자 없이 호출하면 "지금 당장 프레임 하나 그려"다. Duration을 넣으면 "그만큼 시간이 흘렀다고 치고 프레임 하나 그려"다.

이게 왜 필요하냐면 — 애니메이션이나 타이머가 있는 위젯을 테스트할 때.

```dart
testWidgets('3초 뒤에 텍스트가 바뀐다', (tester) async {
  await tester.pumpWidget(MyTimerWidget());

  expect(find.text('대기 중'), findsOneWidget);

  // 3초를 빨리감기
  await tester.pump(Duration(seconds: 3));

  expect(find.text('완료!'), findsOneWidget);
});
```

실제로 3초를 기다리는 게 아니다. 테스트 프레임워크가 "3초가 지났다"고 시뮬레이션하는 거. 그래서 테스트가 빠름.

---

## pumpAndSettle — 더 이상 움직이는 게 없을 때까지 돌린다

`pump()`는 프레임 하나만 그린다. 근데 애니메이션은 여러 프레임에 걸쳐서 일어나잖아. FadeTransition이 300ms 동안 서서히 나타나면 pump 한 번으로는 중간 상태만 보임.

`pumpAndSettle()`은 "더 이상 프레임을 그릴 필요가 없을 때까지" 반복해서 pump를 호출한다:

```dart
await tester.pumpAndSettle();
// = "애니메이션 다 끝날 때까지 계속 프레임 그려"
```

내부적으로 이런 식이다:

```
pumpAndSettle() 호출
  ├─ pump() → 아직 스케줄된 프레임 있음 → 계속
  ├─ pump() → 아직 스케줄된 프레임 있음 → 계속
  ├─ pump() → 아직 스케줄된 프레임 있음 → 계속
  ├─ ...
  └─ pump() → 스케줄된 프레임 없음 → 끝!
```

대부분의 테스트에서는 `pumpAndSettle()`을 쓰면 됨. 근데 주의할 게 있다 — 애니메이션이 무한 반복이면 `pumpAndSettle()`은 영원히 끝나지 않는다. 로딩 스피너 같은 거. 이럴 때는 `pump()`로 특정 시간만큼만 돌려야 한다.

---

## 세 개를 비교하면 이런 차이다

```
pumpWidget(widget)
  → 위젯 트리를 새로 만들고 첫 프레임을 그린다
  → 테스트 시작할 때 딱 한 번 쓴다

pump()
  → 프레임 하나만 그린다
  → 시간을 정밀하게 제어하고 싶을 때 쓴다

pumpAndSettle()
  → 움직이는 게 없을 때까지 프레임을 반복한다
  → 애니메이션이 끝난 최종 상태를 볼 때 쓴다
```

---

## 비동기 데이터 로딩과 pump의 관계

여기서 진짜 헷갈리는 부분이 나온다. Future를 기다리는 위젯을 테스트할 때.

```dart
testWidgets('FutureBuilder 테스트', (tester) async {
  await tester.pumpWidget(
    MaterialApp(
      home: FutureBuilder<String>(
        future: Future.value('데이터 왔다'),
        builder: (context, snapshot) {
          if (snapshot.hasData) return Text(snapshot.data!);
          return CircularProgressIndicator();
        },
      ),
    ),
  );

  // pumpWidget 직후 — Future가 아직 완료 안 됐다!
  expect(find.byType(CircularProgressIndicator), findsOneWidget);

  // pump 한 번 더 — Future가 완료되고 rebuild
  await tester.pump();

  expect(find.text('데이터 왔다'), findsOneWidget);
});
```

`Future.value()`는 즉시 완료되는 Future인데도 `pumpWidget()` 직후에는 로딩 상태다. 왜냐면 `FutureBuilder`가 Future의 결과를 받아서 `setState()`를 호출하려면 마이크로태스크 큐가 처리되어야 하는데, `pumpWidget()` 시점에는 아직 처리 안 됐기 때문.

`pump()`를 한 번 더 호출하면 마이크로태스크가 처리되고 `setState()` → `build()` → 새 프레임이 그려짐.

---

## Completer와 조합하면 타이밍을 완전히 제어한다

진짜 서버 호출은 언제 끝날지 모르잖아. 테스트에서는 [[Completer로 비동기의 리모컨을 쥔다|Completer]]를 써서 "내가 원할 때 데이터를 보내는" 가짜 Future를 만들 수 있다:

```dart
testWidgets('로딩 → 데이터 전환', (tester) async {
  final completer = Completer<String>();

  await tester.pumpWidget(
    MaterialApp(
      home: FutureBuilder<String>(
        future: completer.future,
        builder: (context, snapshot) {
          if (snapshot.hasData) return Text(snapshot.data!);
          return CircularProgressIndicator();
        },
      ),
    ),
  );

  // 아직 complete 안 했으니까 로딩 중
  expect(find.byType(CircularProgressIndicator), findsOneWidget);
  expect(find.text('서버 데이터'), findsNothing);

  // 이제 데이터를 보낸다
  completer.complete('서버 데이터');
  await tester.pumpAndSettle();

  // 데이터가 표시됨
  expect(find.text('서버 데이터'), findsOneWidget);
  expect(find.byType(CircularProgressIndicator), findsNothing);
});
```

이 패턴이 위젯 테스트에서 핵심이다:

```
1. pumpWidget() — 위젯을 심는다
2. expect() — 로딩 상태를 확인한다
3. completer.complete() — 데이터를 보낸다
4. pumpAndSettle() — UI가 갱신될 때까지 기다린다
5. expect() — 최종 상태를 확인한다
```

에러 케이스도 같은 틀이다:

```dart
completer.completeError(Exception('네트워크 에러'));
await tester.pumpAndSettle();
expect(find.text('문제가 생겼습니다'), findsOneWidget);
```

---

## SVG 같은 바이너리 로딩 위젯에서

SVG 렌더링 엔진처럼 내부에서 비동기 디코딩을 하는 위젯은 좀 더 복잡하다. `pumpWidget()` 후에 `pumpAndSettle()`을 해도 디코딩이 별도 스레드에서 일어나면 테스트 프레임워크가 이걸 인식 못 할 수 있음.

그래서 `vector_graphics` 같은 패키지는 `waitForPendingDecodes()`라는 유틸을 제공한다:

```dart
testWidgets('SVG가 그려진다', (tester) async {
  await tester.pumpWidget(
    VectorGraphic(loader: TestBytesLoader(data)),
  );

  // pumpWidget 직후 — 아직 디코딩 중이라 placeholder가 보임
  expect(find.byType(CircularProgressIndicator), findsOneWidget);

  // 디코딩이 끝날 때까지 기다린다
  await vg.waitForPendingDecodes();
  await tester.pumpAndSettle();

  // 이제 SVG가 보임
  expect(find.byType(RawPicture), findsOneWidget);
});
```

`pumpAndSettle()`만으로는 안 되는 이유 — Flutter의 스케줄러가 모르는 곳(Isolate, 네이티브 코드)에서 비동기 작업이 일어나면 "더 이상 그릴 게 없다"고 판단해버림. 실제로는 디코딩이 끝나면 `setState()`가 호출될 건데, 아직 안 끝났으니까 스케줄러는 모르는 거다.

---

## 실전에서 자주 쓰는 패턴 정리

```dart
// 1. 기본 — 위젯 심고 바로 확인
await tester.pumpWidget(MyWidget());
expect(find.text('제목'), findsOneWidget);

// 2. setState 후 — pump 한 번
await tester.tap(find.byType(ElevatedButton));
await tester.pump();  // 탭 후 setState → rebuild
expect(find.text('눌렸다'), findsOneWidget);

// 3. 애니메이션 후 — pumpAndSettle
await tester.tap(find.byType(ElevatedButton));
await tester.pumpAndSettle();  // 페이드 애니메이션 끝날 때까지
expect(find.text('나타났다'), findsOneWidget);

// 4. 특정 시간 후 — pump(duration)
await tester.pump(Duration(seconds: 5));  // 5초 빨리감기
expect(find.text('타이머 끝'), findsOneWidget);

// 5. 비동기 데이터 — Completer + pumpAndSettle
completer.complete(data);
await tester.pumpAndSettle();
expect(find.text('데이터'), findsOneWidget);
```

---

정리하면 — `pumpWidget`은 위젯을 심는 거고, `pump`는 프레임을 한 칸 그리는 거고, `pumpAndSettle`은 멈출 때까지 그리는 거다. 테스트에서는 시간이 자동으로 흐르지 않으니까, 이 세 개로 직접 시간을 조종하는 거다.
