---
title: "앱이 결제하고, 서버가 의심하고, 스토어가 보증하는 구조"
tags:
  - flutter
  - in-app-purchase
  - subscription
  - iOS
  - android
  - server-verification
---

> 모바일 인앱결제는 "앱 → 스토어 → 서버" 3자가 역할을 나눠 가진다.
> 돈은 스토어가 받고, 서버가 진위를 확인하고, 앱은 결과를 보여줄 뿐이다.

---

## 세 명의 등장인물과 각자의 역할

인앱결제에는 항상 세 주체가 있다.

```
┌──────────┐      ┌──────────────┐      ┌──────────┐
│   앱      │ ──── │  스토어       │ ──── │  서버     │
│ (Flutter) │      │ (Apple/Google)│      │ (Spring) │
└──────────┘      └──────────────┘      └──────────┘
  UI 담당           돈 받는 곳           진짜인지 확인
```

- **앱**: 상품을 보여주고, 결제 버튼을 누르게 하고, 결과를 반영한다
- **스토어**: 실제 결제를 처리한다. 카드사/통신사와 연동되는 건 전부 스토어 몫이다
- **서버**: 스토어에게 "이 결제 진짜야?" 물어보고, 구독 상태를 DB에 저장한다

앱이 직접 "결제 성공했으니 광고 제거!" 하면 안 되는 이유가 있다. 앱은 디컴파일할 수 있어서 가짜 영수증을 만들 수 있다. 서버가 스토어에 직접 물어봐야 진짜 결제인지 확인할 수 있다.

---

## 결제가 일어나는 순서

시간 순서대로 따라가면 이렇다.

```
1. 앱 → 서버: "상품 목록 줘"
   서버 → 앱: [{premium, 월간, 7일 무료체험}]

2. 앱 → 스토어: "premium 상품 가격 얼마야?"
   스토어 → 앱: "₩2,900" (사용자 국가/통화에 맞춰서)

3. 사용자가 구매 버튼을 누른다

4. 앱 → 스토어: "premium 결제해줘"
   스토어: 결제 시트를 띄운다 (카드 선택, 생체 인증 등)
   사용자: 결제를 승인한다
   스토어 → 앱: "결제 완료. 영수증 여기 있어"

5. 앱 → 서버: "이 영수증 진짜인지 확인해줘"
   서버 → 스토어 API: "이 영수증 유효해?"
   스토어 → 서버: "응, 유효해. 만료일은 X월 Y일"
   서버 → 앱: {구독 활성, 만료일, 무료체험 여부}

6. 앱: 광고 제거 + 구독 정보 표시
```

2번에서 가격을 스토어에게 직접 묻는 이유가 있다. 한국에서는 2,900원, 미국에서는 $1.99처럼 스토어가 국가별 가격을 자동으로 로컬라이징해준다. 서버가 가격을 내려주면 통화 변환을 직접 해야 한다.

---

## 앱이 결제 이벤트를 받는 방식

Flutter의 `in_app_purchase` 패키지는 **스트림**으로 결제 이벤트를 전달한다. 한 번 구독해놓으면 결제 상태가 바뀔 때마다 이벤트가 들어온다.

```dart
InAppPurchase.instance.purchaseStream.listen((purchases) {
  for (final purchase in purchases) {
    switch (purchase.status) {
      case PurchaseStatus.purchased:
        // 결제 성공 → 서버에 영수증 검증 요청
        verifyWithServer(purchase.purchaseID);
      case PurchaseStatus.error:
        // 결제 실패 → 에러 메시지 표시
      case PurchaseStatus.canceled:
        // 사용자가 취소 → 이전 상태로 복원
      case PurchaseStatus.pending:
        // 결제 진행 중 → 로딩 표시
      case PurchaseStatus.restored:
        // 이전 구매 복원 → 검증 후 반영
    }
  }
});
```

핵심은 `purchaseStream`이 **앱 수명 동안 살아있어야 한다**는 것이다. 화면 전환할 때마다 리스너가 사라지면 결제 완료 이벤트를 놓친다. 그래서 ViewModel은 `AutoDispose`가 아닌 일반 `Notifier`로 만들어야 한다.

---

## completePurchase를 반드시 호출해야 한다

스토어에서 결제가 완료되면 앱은 `completePurchase()`를 호출해서 "이 구매 처리 끝났어"라고 스토어에 알려야 한다.

```dart
// 서버 검증 성공이든 실패든 반드시 호출
await InAppPurchase.instance.completePurchase(purchase);
```

이걸 안 하면 스토어가 "아직 처리 안 됐나보다"라고 판단해서 같은 결제 이벤트를 `purchaseStream`으로 **반복 전달**한다. 서버 검증이 실패해도 `completePurchase`는 호출해야 한다. 안 그러면 무한로딩에 빠진다.

---

## iOS와 Android 서버 검증의 차이

앱 → 서버까지는 똑같다. 차이는 **서버 → 스토어 API** 구간이다.

```
[iOS - Apple]
서버 → Apple Server API: JWT로 요청 (private key로 서명)
인증: private key 문자열 하나면 충분
scope 개념: 없음

[Android - Google]
서버 → Google Play Developer API: OAuth2 토큰으로 요청
인증: 서비스 계정 JSON 키 + scope 선언
scope: "https://www.googleapis.com/auth/androidpublisher" 필수
```

Apple은 private key로 JWT를 만들어 보내면 끝이라 단순하다.
Google은 OAuth2 방식이라 "나 이 API 쓸 거야"라고 scope를 미리 선언해야 한다. scope를 빠뜨리면 토큰은 발급되지만 API 호출 시 403으로 거절당한다.

---

## 스토어가 source of truth다

구독 상태의 진실은 스토어에 있다. 서버 DB도, 앱의 로컬 저장소도 아니다.

```
스토어: "이 사용자는 구독 중" ← 이게 진실
서버 DB: "구독 만료됨"        ← 동기화가 안 된 것일 수 있음
앱 로컬: "구독 중"           ← 캐시가 오래된 것일 수 있음
```

그래서 앱이 시작되거나 foreground로 돌아올 때마다 스토어에 직접 확인한다:

```dart
// 스토어에 "이 사용자 활성 구독 있어?" 물어보기
await InAppPurchase.instance.restorePurchases();
// → purchaseStream으로 활성 구독이 들어온다
```

서버 검증이 실패해도 (500 에러 등) 스토어가 "구독 있다"고 했으면 구독을 유지한다. 서버 에러 때문에 사용자의 유료 구독을 해제하면 안 된다.

---

## 결제 성공 시 즉시 반영해야 하는 것들

서버 검증 결과를 기다리지 않고 **결제 성공 즉시** 반영해야 하는 상태가 있다:

```dart
case PurchaseStatus.purchased:
  // 서버 검증 전에 즉시 반영
  setSubscribed(true);      // 광고 즉시 제거
  setHasUsedTrial(true);    // 무료체험 문구 즉시 변경

  // 그 후에 서버 검증
  final result = await verifyWithServer(purchase);
```

이유: 서버가 500을 반환하면 `hasUsedTrial`이 영원히 `false`로 남아서 "7일 무료체험" 문구가 이미 체험을 쓴 사용자에게도 계속 노출된다. 스토어에서 결제가 성공한 시점에 확정되는 사실은 서버 응답을 기다릴 필요 없이 바로 반영해야 한다.

---

## nullable 필드가 있는 상태 클래스와 copyWith

구독 상태에는 `errorMessage`처럼 **null이 의미 있는** 필드가 있다:

```dart
// 에러 발생 시: errorMessage에 값 설정
state = state.copyWith(errorMessage: '결제 실패');

// 에러 해제 시: errorMessage를 null로 초기화
state = state.copyWith(errorMessage: null);  // ← 이게 동작해야 함
```

수동으로 `copyWith`을 구현하면 `null` 전달과 "아예 안 전달"을 구분할 수 없다:

```dart
// 이렇게 구현하면
copyWith({String? errorMessage}) =>
    State(errorMessage: errorMessage ?? this.errorMessage);
// null을 전달해도 ?? 때문에 기존 값이 유지된다
```

**Freezed**를 쓰면 이 문제가 자동으로 해결된다:

```dart
@freezed
abstract class SubscriptionState with _$SubscriptionState {
  const factory SubscriptionState({
    @Default(false) bool isLoading,
    String? errorMessage,           // Freezed가 null 전달을 정확히 처리
    @Default(false) bool hasUsedTrial,
  }) = _SubscriptionState;
}
```

수동으로 sentinel 패턴(`const _sentinel = Object()`)을 구현할 수도 있지만, Freezed가 같은 걸 깔끔하게 해준다. 프로젝트에 Freezed가 있다면 상태 클래스도 Freezed로 만드는 게 맞다.

---

## 삽질에서 배운 것들

### ViewModel을 AutoDispose로 만들면 결제 이벤트를 놓친다

화면을 벗어나면 ViewModel이 폐기되면서 `purchaseStream` 리스너도 사라진다. 사용자가 스토어 결제 시트에서 결제를 완료하고 돌아왔을 때 리스너가 없으니 결과를 받지 못한다. 구독처럼 앱 전역에서 상태를 유지해야 하는 경우 AutoDispose를 쓰면 안 된다.

### 서버 에러 때문에 UI 플래그가 안 바뀐다

서버 검증 성공 시에만 상태를 업데이트하면, 서버가 죽었을 때 UI가 영원히 이전 상태에 머문다. "스토어에서 결제가 성공했다"는 사실로 확정할 수 있는 것(광고 제거, 무료체험 사용 처리)은 서버 응답 전에 반영해야 한다.

### completePurchase 누락은 무한로딩을 만든다

서버 검증이 실패하면 `completePurchase`를 안 부르고 끝내고 싶은 유혹이 있다. 하지만 그러면 스토어가 같은 이벤트를 계속 보내고, 매번 서버 검증이 실패하고, 또 이벤트가 오고... 무한 루프다. 성공이든 실패든 반드시 호출해야 한다.

---

## 문제가 생겼을 때 따라가는 순서

```
1. purchaseStream에 이벤트가 오는지 → 스토어 결제 자체가 실패한 건 아닌지
2. purchase.status가 뭔지 → purchased / error / canceled 분기 확인
3. 서버 verify 응답 코드 → 200이 아니면 서버 쪽 문제
4. 서버 → 스토어 API 호출 로그 → 인증(scope/key) 문제인지, 토큰 만료인지
5. completePurchase 호출 여부 → 같은 이벤트가 반복되면 누락된 것
```
