---
title: "Dio 타임아웃 버그 분석"
tags:
  - dart
  - http-client
  - xhr
  - browser-security
  - cors
  - adapter-pattern
  - open-source
---

> HTTP 클라이언트가 웹에서 `receiveTimeout`인데 `connectionTimeout`으로 잘못 보고하는 버그. 브라우저 보안 모델이 만드는 제약 안에서, XHR의 readyState로 타임아웃 종류를 추론한 과정.

---

## 모바일은 소켓을 직접 쥐고 있지만 웹은 아니다

HTTP 요청을 보내는 앱이 있다. 모바일에서 빌드하면 잘 동작한다. 같은 코드를 웹에서 빌드하면, 데이터를 받는 중에 타임아웃이 나는데 에러 타입이 `connectionTimeout`이라고 뜬다. 받는 중에 터졌으니 `receiveTimeout`이어야 맞는데.

이 차이는 HTTP 클라이언트가 플랫폼마다 완전히 다른 네트워킹 계층 위에서 동작하기 때문에 생긴다.

```
모바일 앱                        웹 앱
───────                        ─────
dart:io 소켓 직접 제어            브라우저의 XHR 창구를 통해야 함
↓                               ↓
연결·수신 각 단계를 코드가 직접 봄    브라우저가 내부 상태를 다 처리
↓                               ↓
타임아웃 종류 정확히 구분 가능       "시간 초과" 한마디만 들을 수 있음
```

모바일은 TCP 소켓을 직접 만진다. 연결이 시작되는 순간, 서버가 응답 헤더를 보내는 순간, 바디 데이터가 도착하는 순간을 코드가 전부 관찰한다. 각 단계에 별도 타이머를 걸 수 있으니 "어느 단계에서 느린지"를 정확히 안다.

웹은 다르다. 브라우저가 네트워크를 통제한다. 앱 코드는 브라우저의 XMLHttpRequest(XHR) 객체를 통해서만 요청을 보낼 수 있다. 브라우저가 내부적으로 연결, 핸드셰이크, 데이터 수신을 전부 처리한 뒤 결과만 알려준다.

---

## 브라우저는 왜 네트워크를 감추나

이 제약에는 이유가 있다. 브라우저 보안의 출발점은 **Same-Origin Policy**다.

악성 사이트 evil.com을 열었다고 하자. 이 사이트의 JavaScript가 내 은행 사이트 mybank.com에 몰래 송금 요청을 보낸다. 브라우저에는 mybank.com의 로그인 쿠키가 남아 있고, 브라우저는 쿠키를 자동으로 붙인다. 이게 **CSRF(Cross-Site Request Forgery)** 공격이다.

Same-Origin Policy는 이걸 막기 위해 규칙을 세운다:

```
Origin = 프로토콜 + 도메인 + 포트
예) https://mybank.com:443

다른 Origin에서 보낸 요청의 응답 → 스크립트에 전달하지 않음
```

핵심: **요청 자체를 막는 게 아니라 응답을 숨기는 것이다.** 요청은 서버에 도달하고, DB 변경도 일어날 수 있다. 그래서 Same-Origin Policy만으로는 완전한 보안이 안 된다.

---

## CORS는 서버가 발급하는 허가증이다

그렇다고 다른 출처와의 통신을 완전히 막을 수는 없다. API 서버와 프론트엔드 서버가 다른 도메인에 있는 건 흔한 일이다. 그래서 **CORS(Cross-Origin Resource Sharing)** 가 생겼다.

```
브라우저 → 서버:  "api.example.com이 요청해도 됩니까?" (Preflight OPTIONS)
서버 → 브라우저:  "응, 허용해." (Access-Control-Allow-Origin 헤더)
브라우저:          "서버가 허락했으니 응답을 스크립트에 전달."
```

서버가 특정 출처를 허용한다고 직접 선언하는 방식이다.

```python
# 서버 측 CORS 설정 예시
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://myapp.com"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
)
```

CORS가 막는 건 **응답 내용 훔쳐보기**다. 못 막는 건 **DB 변경**이다. 그래서 쓰기 작업에는 CSRF 토큰 같은 추가 보안이 필요하다. CSRF 토큰은 서버가 발급한 일회용 번호표를 요청마다 같이 보내는 방식인데, 이 번호표는 실제 페이지 HTML 안에 숨겨져 있어서 Same-Origin Policy 때문에 다른 출처에서는 훔칠 수 없다.

참고로 모바일 앱에서 CSRF가 문제되지 않는 이유가 있다. 모바일은 브라우저가 아니라 쿠키를 자동으로 붙이지 않는다. 헤더에 JWT를 직접 넣기 때문에 쿠키 기반 공격이 성립하지 않는다.

---

## XHR에게는 타임아웃이 하나뿐이다

이런 보안 모델 때문에 웹 앱은 네트워크 요청을 직접 만들 수 없고, XHR이라는 브라우저 API를 거쳐야 한다.

XHR은 2000년대 초 Gmail이 "페이지 새로고침 없이 데이터만 받아오는 기술"로 탄생했다. 덕분에 SPA(Single Page Application)가 가능해졌다. 한 번 뼈대를 받은 뒤 필요한 데이터만 XHR로 주고받는 것이다.

문제는 XHR의 타임아웃이 **딱 하나**라는 것이다:

```javascript
xhr.timeout = 30000;  // 타임아웃 설정은 1개
xhr.ontimeout = () => {
  // 연결 중에 터진 건지? 데이터 받다가 터진 건지?
  // XHR은 그냥 "시간 초과"만 알려준다.
};
```

대신 XHR에는 **readyState**라는 속성이 있다. 현재 요청이 어느 단계에 있는지를 나타낸다:

```
0: UNSENT           XHR 객체 생성됨
1: OPENED           연결 시도 중     ← 여기서 타임아웃 = connectionTimeout
2: HEADERS_RECEIVED 서버 응답 헤더 수신 (연결 성공 확정!)
3: LOADING          데이터 수신 중   ← 여기서 타임아웃 = receiveTimeout
4: DONE             완료
```

readyState 2(HEADERS_RECEIVED) 이상이면 서버와 연결에 성공한 것이다. 이 상태에서 터진 타임아웃은 `receiveTimeout`이어야 한다. 2 미만이면 아직 연결도 안 된 거니까 `connectionTimeout`이다.

이 readyState가 버그 수정의 열쇠다.

---

## 같은 API 호출인데 어댑터가 다르다

HTTP 클라이언트 라이브러리는 이 플랫폼 차이를 어떻게 해결하나? **어댑터 패턴**을 쓴다.

```
HttpClientAdapter (계약)
    └─ fetch()  "이걸 구현하면 HTTP 요청을 보낼 수 있다"

IOHttpClientAdapter (모바일)           BrowserHttpClientAdapter (웹)
    └─ dart:io 소켓 직접 제어              └─ dart:html XHR 사용
    └─ 타임아웃 3종류 정확히 구분            └─ 타임아웃 구분 못 함 ← 버그
```

라이브러리를 쓰는 개발자는 `dio.get()` 한 줄만 쓰면 된다. 내부에서 빌드 타겟에 따라 어떤 어댑터를 쓸지가 **컴파일 시점에 결정**된다:

```dart
// Dart의 조건부 임포트
export 'adapter_stub.dart'
    if (dart.library.io)   'io_adapter.dart'      // 모바일용
    if (dart.library.html) 'browser_adapter.dart'; // 웹용
```

`flutter run -d android`이면 `dart.library.io`가 활성화되어 모바일 어댑터가 선택된다. `flutter run -d chrome`이면 `dart.library.html`이 활성화되어 웹 어댑터가 선택된다. 개발자 코드는 동일하지만 런타임 동작이 완전히 달라진다.

---

## 타이머 하나가 모든 걸 connectionTimeout으로 만들었다

웹 어댑터의 코드를 열어보면 타임아웃 경로가 두 가지다.

**경로 1: 자체 타이머.** `connectTimeout` 시간만큼 기다리는 Timer를 건다. 시간이 차면 무조건 `connectionTimeout`으로 에러를 던진다:

```dart
connectTimeoutTimer = Timer(connectTimeout, () {
  connectTimeoutTimer = null;
  xhr.abort();
  completer.completeError(DioException.connectionTimeout(...));
  // ← readyState 상관없이 무조건 connectionTimeout!
});
```

**경로 2: XHR의 timeout 이벤트.** `connectTimeout + receiveTimeout`을 합산해서 XHR에 설정한다. 시간이 차면 "타이머 객체가 아직 살아있는가?"로 연결 중인지 판별한다:

```dart
xhr.timeout = connectTimeout + receiveTimeout;  // 합산값
timeoutEvent.listen((_) {
  final isConnectTimeout = connectTimeoutTimer != null;  // 타이머 존재 여부로 판별
  if (isConnectTimeout) { /* connectionTimeout */ }
  else { /* receiveTimeout */ }
});
```

이 타이머는 바디 데이터가 도착하면 취소된다:

```dart
xhr.onProgress.listen((event) {
  connectTimeoutTimer?.cancel();
  connectTimeoutTimer = null;  // 여기서 취소
});
```

문제가 보이는가? `onProgress`는 **바디 데이터가 도착해야** 발생한다. 서버가 응답 헤더만 보내고 바디를 늦게 보내는 경우, 헤더는 왔으니 연결은 된 건데 타이머는 아직 살아있다. 이 상태에서 타이머가 터지면 — 연결 성공 후인데도 `connectionTimeout`으로 보고한다.

---

## readyState로 실제 연결 상태를 확인한다

수정은 두 군데 모두 readyState 체크를 추가하는 것이다.

**자체 타이머 수정:** 타이머가 터졌을 때, readyState가 2(HEADERS_RECEIVED) 미만이면 진짜 연결 실패니까 에러를 던진다. 2 이상이면 연결은 됐으니 아무것도 안 하고 `receiveTimer`가 처리하게 둔다.

```dart
connectTimeoutTimer = Timer(connectTimeout, () {
  connectTimeoutTimer = null;
  if (xhr.readyState < HEADERS_RECEIVED) {
    xhr.abort();
    completer.completeError(DioException.connectionTimeout(...));
  }
  // readyState >= HEADERS_RECEIVED면 연결됐으므로
  // receiveTimer가 나중에 처리
});
```

**XHR timeout 수정:** 타이머 존재 여부 대신 readyState로 직접 판별한다.

```dart
timeoutEvent.listen((_) {
  connectTimeoutTimer?.cancel();
  if (xhr.readyState < HEADERS_RECEIVED) {
    completer.completeError(DioException.connectionTimeout(...));
  } else {
    completer.completeError(DioException.receiveTimeout(...));
  }
});
```

타이머는 **"언제" 확인할지**(시간 측정)를 담당하고, readyState는 **"무엇이" 문제인지**(상태 판별)를 담당한다. 역할을 분리한 것이다.

타이머를 아예 없앨 수 없는 이유가 있다. `connectTimeout=5초, receiveTimeout=60초`인 경우, XHR의 timeout은 65초로 설정된다. 타이머 없이 XHR timeout에만 의존하면 연결이 안 되는 서버에 65초를 기다려야 한다. 타이머가 있어야 5초 만에 연결 실패를 감지할 수 있다.

---

## Chrome에서는 테스트조차 재현이 안 됐다

수정 코드를 테스트하려고 로컬 서버를 띄웠다. 서버에서 헤더만 먼저 보내고 바디를 3초 후에 보내는 시나리오를 만들었다.

```
서버: 헤더 즉시 전송, 바디 3초 후 전송

기대: 헤더 도착 시 readyState가 2(HEADERS_RECEIVED)로 바뀔 것
결과: readyState가 1(OPENED)에 머물다가, 바디가 올 때 2→3→4 한꺼번에 전환
```

**Chrome은 헤더와 바디를 묶어서 처리한다.** 헤더만 도착해도 readyState를 업데이트하지 않는다. 바디가 와야 비로소 상태가 바뀐다.

이 때문에 Chrome에서는 수정 전 코드와 수정 후 코드의 동작이 동일하다. readyState 변경과 `onProgress` 발생이 항상 동시에 일어나기 때문이다.

하지만 Firefox나 Safari는 readyState를 독립적으로 업데이트한다. 이 브라우저들에서는 헤더만 온 상태에서도 readyState가 2로 바뀌고, 이때 수정 코드가 실제로 차이를 만든다. 그리고 원래 이슈를 보고한 사용자도 이런 환경에서 문제를 겪은 것이다.

---

## 삽질에서 배운 것들

### 플랫폼 추상화 아래를 봐야 한다

`dio.get()` 한 줄이 모바일과 웹에서 완전히 다른 코드를 실행한다는 걸 모르면 이 버그를 이해할 수 없다. 라이브러리가 추상화를 해주더라도, 디버깅할 때는 그 아래를 봐야 한다.

### 브라우저마다 XHR 동작이 다르다

Chrome에서 재현 안 되는 버그가 Firefox에서는 재현된다. 브라우저 테스트는 한 브라우저만으로는 부족하다.

### 오픈소스 기여 체크리스트

- CHANGELOG.md 업데이트 (해당 패키지의 Unreleased 섹션)
- 테스트 추가 (불가능하면 이유 명시)
- `dart analyze` 통과 확인
- 기존 테스트가 깨지지 않는지 확인

---

## 참고

- [Dio 이슈 #2421](https://github.com/cfug/dio/issues/2421)
- [XHR readyState MDN](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/readyState)
- [CORS MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
