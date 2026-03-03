---
title: "Riverpod AutoDispose"
tags:
  - flutter
  - riverpod
  - state-management
  - lifecycle
  - provider
---

## 에어컨을 끄고 다니는 사람

집에서 방을 옮길 때마다 에어컨을 끈다고 생각해보자. 거실에서 에어컨을 틀고, 방으로 가면 거실 에어컨을 끈다. 방에서 에어컨을 틀고, 화장실에 가면 방 에어컨을 끈다. 돌아오면 또 켜고. 이게 **AutoDispose**다. 아무도 안 쓰면 꺼버린다.

보통은 이게 좋다. 에너지 절약이니까. 근데 만약 서버실 에어컨이라면? 사람이 없다고 끄면 서버가 다 녹는다. 서버실 에어컨은 24시간 돌아가야 한다. 이게 AutoDispose를 **안** 쓰는 경우다.

---

## 먼저, Provider의 생명주기를 이해해야 한다

Riverpod에서 Provider는 상태를 담는 그릇이다. 이 그릇이 언제 만들어지고 언제 사라지는지 — 이게 생명주기.

```
Provider 생성 ──────► 누군가 읽음 ──────► 상태 유지 ──────► ???
                      (ref.watch)        (메모리에 살아있음)
```

`???` 자리에 뭐가 오는지가 핵심이다. 두 가지 시나리오가 있음.

**시나리오 1: AutoDispose 사용**
```
Provider 생성 → 위젯이 읽음 → 위젯이 화면에서 사라짐 → 아무도 안 읽음 → 💀 폐기
```

**시나리오 2: AutoDispose 미사용**
```
Provider 생성 → 위젯이 읽음 → 위젯이 화면에서 사라짐 → 아무도 안 읽음 → 😴 그냥 살아있음
```

차이가 보이지? AutoDispose는 "이 상태를 누가 보고 있나?" 계속 감시한다. 아무도 안 보면 치워버림.

---

## AutoDispose가 동작하는 방식

Riverpod은 내부적으로 리스너 수를 추적한다. `ref.watch`나 `ref.listen`으로 Provider를 구독하면 리스너 카운트가 올라가고, 위젯이 dispose되면 카운트가 내려감.

```
리스너 수: 0 → 1 (화면A가 watch) → 2 (화면B도 watch) → 1 (화면A 사라짐) → 0 (화면B도 사라짐)
                                                                                    ↓
                                                                          AutoDispose: "0이네? 삭제!"
```

코드로 보면 이런 차이다.

```dart
// AutoDispose 사용 — 아무도 안 보면 죽는다
@riverpod
class SearchViewModel extends _$SearchViewModel {
  @override
  List<String> build() => [];
}

// AutoDispose 미사용 — 앱이 꺼질 때까지 산다
@Riverpod(keepAlive: true)
class AuthViewModel extends _$AuthViewModel {
  @override
  AuthState build() => AuthState.initial();
}
```

`@riverpod`은 기본이 AutoDispose다. `keepAlive: true`를 붙여야 안 죽는다.

---

## 폐기되면 정확히 무슨 일이 일어나나

Provider가 폐기되면 세 가지가 동시에 일어난다.

```
1. 상태가 초기값으로 리셋됨
   searchResults: ['사과', '바나나'] → []

2. ref.onDispose()에 등록한 콜백이 실행됨
   스트림 구독 해제, 타이머 취소, 컨트롤러 dispose 등

3. 다음에 누가 다시 읽으면 build()가 처음부터 다시 실행됨
   완전 새 인스턴스. 이전 상태? 없다
```

이걸 체감할 수 있는 상황: 검색 화면에서 "사과"를 검색하고 결과가 나옴. 다른 화면으로 갔다가 돌아오면? AutoDispose라면 검색 결과가 사라져있다. `build()`가 다시 돌면서 빈 리스트로 시작하니까.

---

## AutoDispose를 써야 하는 경우

대부분의 화면 단위 상태는 AutoDispose가 맞다. 화면을 떠나면 더 이상 필요 없는 것들.

**검색 화면의 검색 결과**
```dart
@riverpod
class SearchViewModel extends _$SearchViewModel {
  @override
  List<Item> build() => [];

  Future<void> search(String query) async {
    state = await repository.search(query);
  }
}
// 검색 화면을 나가면 결과를 굳이 들고 있을 이유가 없다
```

**폼 입력 상태**
```dart
@riverpod
class ProfileFormViewModel extends _$ProfileFormViewModel {
  @override
  ProfileForm build() => ProfileForm.empty();

  void updateName(String name) {
    state = state.copyWith(name: name);
  }
}
// 폼 화면을 나가면 입력 중이던 데이터는 버려도 된다
```

**상세 페이지 데이터**
```dart
@riverpod
class ProductDetail extends _$ProductDetail {
  @override
  Future<Product> build(String productId) async {
    return await repository.getProduct(productId);
  }
}
// 상세 페이지를 닫으면 해당 상품 데이터는 메모리에서 해제
```

공통점이 보인다. 전부 **특정 화면에 종속된 상태**라는 거다. 그 화면이 없으면 의미도 없는 데이터.

---

## AutoDispose를 쓰면 안 되는 경우

문제는 화면을 넘어서 살아야 하는 상태다. 화면이 사라져도 상태가 유지되어야 하는 놈들.

**인증 상태**
```dart
@Riverpod(keepAlive: true)
class AuthViewModel extends _$AuthViewModel {
  @override
  AuthState build() {
    return AuthState.initial();
  }
}
// 로그인했는데 다른 화면 갔다고 로그아웃되면 안 된다
```

**결제 스트림 리스너**
```dart
@Riverpod(keepAlive: true)
class PurchaseViewModel extends _$PurchaseViewModel {
  @override
  PurchaseState build() {
    _listenToPurchaseStream();
    return PurchaseState.initial();
  }

  void _listenToPurchaseStream() {
    final stream = InAppPurchase.instance.purchaseStream;
    ref.onDispose(() => _subscription?.cancel());
    _subscription = stream.listen(_handlePurchase);
  }
}
```

이게 [[Flutter 인앱결제 구현]]에서 말한 그 문제다. 결제 스트림은 앱 전체에서 하나만 돌아야 한다.

왜 위험한지 시나리오로 보자:

```
1. 사용자가 결제 화면에 들어감 → PurchaseViewModel 생성, 스트림 구독 시작
2. 사용자가 "구매" 버튼을 누름 → 스토어 결제 시트가 뜸
3. 스토어 결제 시트 때문에 앱이 잠깐 백그라운드로 밀림
4. (AutoDispose라면) 화면에서 리스너가 사라짐 → ViewModel 폐기 → 스트림 구독 해제 💀
5. 사용자가 결제를 완료하고 앱으로 돌아옴
6. 스토어가 "결제 완료" 이벤트를 쏨
7. 근데 받을 놈이 없다. 리스너가 죽었으니까
8. 사용자: 결제했는데 왜 아무것도 안 바뀌지...?
```

**웹소켓 연결**
```dart
@Riverpod(keepAlive: true)
class ChatConnection extends _$ChatConnection {
  @override
  ChatState build() {
    _connectWebSocket();
    return ChatState.disconnected();
  }
}
// 채팅 목록 화면을 벗어나도 메시지를 계속 받아야 한다
```

**앱 설정 / 테마**
```dart
@Riverpod(keepAlive: true)
class ThemeViewModel extends _$ThemeViewModel {
  @override
  ThemeMode build() {
    return _loadSavedTheme();
  }
}
// 다크모드 설정이 화면마다 리셋되면 곤란하다
```

공통점: **앱 전역에서 유지되어야 하는 상태**. 특정 화면이 아니라 앱 자체의 상태.

---

## 판단 기준 — 이 질문 하나면 된다

> "이 상태를 보는 화면이 전부 사라져도, 상태가 살아있어야 하나?"

- **예** → `keepAlive: true` (AutoDispose 끄기)
- **아니오** → 기본 `@riverpod` (AutoDispose 켜기)

```
                    화면이 사라지면?
                    ┌─────────────┐
                    │             │
              상태도 사라져도 됨    상태는 남아야 함
                    │             │
              @riverpod      @Riverpod(keepAlive: true)
                    │             │
              검색 결과          인증 토큰
              폼 입력            결제 스트림
              상세 데이터         웹소켓 연결
              페이지네이션        앱 설정
```

---

## keepAlive를 남발하면 생기는 일

"그냥 다 keepAlive하면 안전하지 않나?" 하는 생각이 들 수 있다. 근데 그러면 앱이 점점 무거워진다.

```
앱 시작 → 홈 화면 Provider 생성
       → 검색 화면 Provider 생성 (안 죽음)
       → 상품 상세 Provider 생성 (안 죽음)
       → 또 다른 상품 Provider 생성 (안 죽음)
       → 주문 내역 Provider 생성 (안 죽음)
       → ...
       → 메모리: 📈📈📈
```

AutoDispose가 없으면 한번이라도 생성된 Provider는 전부 메모리에 남는다. 상품 상세를 100개 봤으면 100개의 상태가 메모리에 살아있다. 가비지 컬렉터가 수거를 못 하는 거다. 주인(리스너)이 있으니까.

AutoDispose는 메모리 관리를 자동으로 해주는 장치다. 필요한 것만 남발하지 말고, 정말 앱 전역에서 필요한 것만 keepAlive하자.

---

## ref.keepAlive() — 중간 지점이 필요할 때

"화면을 나갔다 바로 돌아오면 데이터가 다시 로딩되는 게 싫은데, 그렇다고 영원히 들고 있고 싶진 않아."

이럴 때 `ref.keepAlive()`를 쓴다. AutoDispose Provider 안에서 조건부로 살려두는 거다.

```dart
@riverpod
class ProductDetail extends _$ProductDetail {
  @override
  Future<Product> build(String productId) async {
    // 데이터를 성공적으로 가져오면 살려둠
    final link = ref.keepAlive();

    // 5분 뒤에는 놓아줌 (AutoDispose가 다시 작동)
    final timer = Timer(Duration(minutes: 5), link.close);
    ref.onDispose(timer.cancel);

    return await repository.getProduct(productId);
  }
}
```

이렇게 하면:
```
화면 진입 → 데이터 로드 → keepAlive 활성화
화면 이탈 → 리스너 0개 → 근데 keepAlive 때문에 안 죽음
5분 경과 → link.close() → keepAlive 해제 → 리스너 0개니까 폐기
다시 진입 → 5분 안이면 캐시된 데이터 즉시 표시, 지났으면 다시 로드
```

캐시 느낌이다. 잠깐은 살려두되, 너무 오래되면 정리하는 거.

---

## 코드 제너레이션 없이 쓸 때

어노테이션(`@riverpod`) 없이 직접 Provider를 선언하면 이름이 좀 다르다.

```dart
// AutoDispose (기본)
final searchProvider = AutoDisposeNotifierProvider<SearchNotifier, List<String>>(
  SearchNotifier.new,
);

// keepAlive
final authProvider = NotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);
```

`AutoDisposeNotifierProvider` vs `NotifierProvider`. 코드 제너레이션을 쓰면 `@riverpod` vs `@Riverpod(keepAlive: true)`로 깔끔하게 표현되는 거다. 하는 일은 완전히 똑같음.

---

## 삽질에서 건진 것들

AutoDispose Provider에서 스트림을 구독하면 화면 전환 시 이벤트를 놓친다. "왜 콜백이 안 불리지?" 하고 디버깅하면 Provider 자체가 죽어서 리스너가 해제된 거였음. 스트림을 장기간 구독해야 하는 Provider는 반드시 keepAlive.

keepAlive를 전부 켜놓고 "메모리 누수가 있는 것 같다"고 삽질한 적도 있다. DevTools에서 Provider 인스턴스 수를 세보면 한번 방문한 화면마다 하나씩 살아있었음. AutoDispose가 기본인 데는 이유가 있다. 대부분의 상태는 화면과 함께 사라져야 하니까.

`ref.keepAlive()`의 `link.close()`를 호출 안 하면 사실상 영구 keepAlive와 같다. 타이머든 조건이든, 반드시 close를 호출하는 경로를 만들어놔야 한다.
