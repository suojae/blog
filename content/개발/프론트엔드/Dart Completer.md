---
title: "Dart Completer"
tags:
  - dart
  - 비동기
  - flutter
  - 위젯테스트
  - completer
---

## 일단 Future부터 다시 보자

`await` 쓸 때 뒤에 오는 그거. 서버한테 데이터 달라고 하면 바로 안 주잖아. "잠깐만, 준비되면 줄게" — 이게 Future다.

```dart
final user = await getUser();  // 서버가 줄 때까지 여기서 멈춤
print(user.name);              // 받으면 이어서 실행
```

여기서 `getUser()`가 언제 끝나는지는 서버가 정한다. 내가 개입할 수 없음.

---

## Completer는 Future의 완료 버튼을 빼낸 거다

비유를 하나 들어볼게. 카페에서 진동벨 받아본 적 있지?

- **Future** = 진동벨 자체. 울리면 가서 받으면 됨.
- **Completer** = 진동벨 + 카운터 뒤에 있는 버튼. 내가 직접 누를 수 있음.

보통은 주방(시스템)이 알아서 벨을 울리는데, Completer를 쓰면 그 버튼을 내가 쥔다.

```dart
final completer = Completer<String>();  // 벨이랑 버튼 세트로 만듦

// 누군가한테 벨을 줌
final bell = completer.future;  // 이걸 await 하면 울릴 때까지 기다림

// 한참 뒤에 내가 버튼을 누름
completer.complete('아메리카노 나왔습니다');  // 이 순간 await가 풀림
```

---

## 제일 간단한 예제

3초 뒤에 내가 직접 완료시키는 Future:

```dart
Future<String> makeWait() {
  final completer = Completer<String>();

  Timer(Duration(seconds: 3), () {
    completer.complete('3초 지남');  // 3초 뒤에 버튼 누름
  });

  return completer.future;
}

// 쓰는 쪽
final msg = await makeWait();
print(msg);  // 3초 후에 '3초 지남' 출력
```

`async/await`으로도 할 수 있는 거 아니냐고? 맞음. 이 정도는 굳이 Completer 안 써도 됨. 진짜 필요한 건 다음부터임.

---

## 콜백밖에 없는 놈을 await로 바꾸기

Flutter 개발하다 보면 이런 코드를 만남. 네이티브 SDK, 결제 모듈, 위치 권한 요청 같은 거:

```dart
locationPlugin.requestPermission(
  onGranted: () { /* 허용됨 */ },
  onDenied: () { /* 거부됨 */ },
);
```

콜백 안에 갇혀있어서 await를 못 쓴다. Completer로 꺼내면:

```dart
Future<bool> requestLocation() {
  final completer = Completer<bool>();

  locationPlugin.requestPermission(
    onGranted: () => completer.complete(true),
    onDenied: () => completer.complete(false),
  );

  return completer.future;
}

// 이제 이렇게 쓸 수 있음
final granted = await requestLocation();
if (granted) { /* 위치 쓰기 */ }
```

콜백 지옥에서 한 줄로 탈출하는 거다.

---

## 또 다른 예: 유저가 뭔가 선택할 때까지 기다리기

다이얼로그 띄우고 유저가 버튼 누를 때까지 기다리고 싶다고 하자:

```dart
Future<String> askUser() {
  final completer = Completer<String>();

  showDialog(
    context: context,
    builder: (_) => AlertDialog(
      actions: [
        TextButton(
          onPressed: () => completer.complete('확인'),
          child: Text('확인'),
        ),
        TextButton(
          onPressed: () => completer.complete('취소'),
          child: Text('취소'),
        ),
      ],
    ),
  );

  return completer.future;
}

final answer = await askUser();
print(answer);  // 유저가 누를 때까지 여기서 멈춤
```

유저가 버튼을 누르는 순간 `complete()`가 호출되고 `await`가 풀린다.

---

## 테스트에서 진짜 빛남

위젯 테스트 짤 때 제일 짜증나는 게 타이밍이다. "로딩 스피너 잘 나오나?" 확인하려면 데이터가 아직 안 온 상태를 정확히 잡아야 되는데, 진짜 서버 쓰면 언제 응답 올지 모르잖아.

Completer 쓰면 내가 버튼 안 누를 때까지 절대 안 오니까, 그 사이에 확인하면 됨:

```dart
testWidgets('로딩 → 데이터', (tester) async {
  final completer = Completer<List<String>>();

  await tester.pumpWidget(
    MyWidget(dataFuture: completer.future),
  );

  // 아직 안 눌렀으니까 로딩 중이어야 함
  expect(find.byType(CircularProgressIndicator), findsOneWidget);

  // 지금 누른다
  completer.complete(['우유', '빵']);
  await tester.pumpAndSettle();

  // 데이터 나와야 됨
  expect(find.text('우유'), findsOneWidget);
});
```

에러 테스트도 같은 틀에서 버튼만 다르게 누르면 끝:

```dart
completer.completeError(Exception('터짐'));
await tester.pumpAndSettle();
expect(find.text('문제가 생겼습니다'), findsOneWidget);
```

---

## 조심할 거 하나

한 번 울린 벨은 다시 못 울림. 두 번 누르면 에러남.

```dart
completer.complete('첫 번째');  // OK
completer.complete('두 번째');  // StateError 터짐
```

불안하면 `completer.isCompleted`로 확인하고 누르면 됨.

---

정리하면, Future는 "나중에 줄게"고 Completer는 "내가 줄 타이밍을 정할게"다. 콜백을 await로 바꾸거나, 테스트에서 타이밍 잡을 때 쓰면 된다.
