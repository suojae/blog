---
title: "쿠키와 CSRF"
tags:
  - cookie
  - csrf
  - http
  - security
  - web
  - browser
  - session
  - flutter
---

> 앱 개발자에게 쿠키는 낯설다. 모바일 앱은 토큰을 직접 저장하고, 직접 꺼내서, 직접 헤더에 붙인다. 브라우저는 다르다. 쿠키라는 걸 알아서 저장하고, 알아서 꺼내서, 알아서 붙인다. 이 "알아서"가 편리하기도 하고, 위험하기도 하다.

---

## HTTP는 기억력이 없다

이야기의 시작은 쿠키가 아니라 HTTP다.

카페에 간다. 아메리카노를 주문한다. 바리스타가 만들어준다. 끝. 다음 날 또 간다. 바리스타는 나를 기억 못 한다. "어제 아메리카노 드셨죠?"라고 하지 않는다. 매번 처음 온 손님.

HTTP가 딱 이렇다. **무상태(stateless)** 프로토콜. 서버는 요청 하나를 받고, 응답 하나를 보내고, 끊는다. 다음 요청이 오면 이전 요청을 기억하지 않는다.

```
요청 1: "로그인할게, ID는 jeon이야"
서버: "확인, 로그인 성공"  ← 여기서 끝. 기억 안 함.

요청 2: "내 프로필 보여줘"
서버: "너 누구야?"  ← 방금 로그인한 사람인 줄 모름
```

로그인 한 번 했는데, 페이지 넘길 때마다 "너 누구야?" 하면 쓸 수가 없다. 서버에게 기억력을 줘야 한다. 근데 HTTP 자체를 바꿀 순 없다. 그래서 **서버가 쪽지를 하나 써서 브라우저에게 건넨다.** "이거 가지고 다니다가 올 때마다 보여줘." 이 쪽지가 쿠키다.

---

## 쿠키가 오가는 장면

실제 흐름을 장면별로 따라가보자.

**장면 1 — 로그인 성공, 서버가 쪽지를 써준다**

```
브라우저 → POST /login { id: "jeon", pw: "1234" } → 서버

서버: "아, jeon이구나. 세션 하나 만들어둘게."
      세션 저장소에 기록: session_abc → { userId: "jeon", loginTime: "..." }

서버 → 응답 헤더에 쪽지를 끼워 보냄:
      Set-Cookie: sessionId=session_abc

브라우저: "쿠키? 저장해둬야겠다." → 내부 쿠키 저장소에 보관
```

`Set-Cookie`는 서버가 브라우저에게 "이걸 저장해"라고 보내는 응답 헤더다. 브라우저는 이걸 받으면 자기 내부 저장소에 넣어둔다.

**장면 2 — 다음 요청, 브라우저가 쪽지를 알아서 꺼낸다**

```
브라우저 → GET /profile → 서버
           Cookie: sessionId=session_abc   ← 브라우저가 알아서 붙임!

서버: "session_abc? 아, jeon이구나."
      세션 저장소에서 조회 → { userId: "jeon" }
      → jeon의 프로필 데이터 응답
```

브라우저가 쿠키를 자동으로 붙인다. JavaScript 코드가 "쿠키 꺼내서 헤더에 넣어"라고 하지 않아도. 그냥 해당 서버에 요청이 갈 때 알아서. 이게 핵심이다. **개발자가 안 해도 브라우저가 한다.**

**장면 3 — 반복**

```
GET /settings   → Cookie: sessionId=session_abc  (자동)
POST /update    → Cookie: sessionId=session_abc  (자동)
GET /dashboard  → Cookie: sessionId=session_abc  (자동)

모든 요청에 쿠키가 따라붙는다. 서버는 매번 "아, jeon이구나" 확인 가능.
```

이렇게 HTTP가 기억력을 갖게 된다. 서버가 기억하는 게 아니라, 브라우저가 매번 "나 이 사람이야"라고 증명서를 보여주는 것이다.

---

## 앱 개발자가 하던 것과 비교하면

Flutter 앱에서 로그인 처리 어떻게 했는지 떠올려보자.

```dart
// 1. 로그인해서 토큰 받음
final response = await dio.post('/login', data: credentials);
final token = response.data['accessToken'];

// 2. 토큰을 직접 저장함
await secureStorage.write(key: 'token', value: token);

// 3. 다음 요청할 때 직접 꺼내서 직접 붙임
dio.options.headers['Authorization'] = 'Bearer $token';
```

전부 **직접**이다. 저장도 내가, 꺼내는 것도 내가, 헤더에 붙이는 것도 내가.

브라우저 쿠키는 이렇다:

```
1. 서버가 Set-Cookie 헤더로 보냄 → 브라우저가 알아서 저장
2. 다음 요청 → 브라우저가 알아서 Cookie 헤더에 붙임
3. 개발자는 쿠키의 존재를 모를 수도 있음
```

```
앱:        토큰 저장 → 토큰 꺼냄 → 헤더에 붙임 (전부 수동)
브라우저:   쿠키 저장 → 쿠키 꺼냄 → 헤더에 붙임 (전부 자동)
```

이 "자동"이 편리한 동시에 문제의 씨앗이 된다.

---

## 쿠키에 붙는 옵션들 — 쪽지에도 조건이 있다

서버가 쿠키를 보낼 때 옵션을 붙일 수 있다. 실제 `Set-Cookie` 헤더를 보면:

```
Set-Cookie: sessionId=session_abc; Domain=mybank.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600
```

하나씩 풀어보자.

**Domain — 이 쪽지를 어느 사이트에 보여줄지**

```
Domain=mybank.com
→ mybank.com과 그 하위 도메인(api.mybank.com 등)에만 쿠키를 보냄
→ evil.com에는 보내지 않음 (당연히)
```

**Path — 사이트 안에서도 특정 경로에만**

```
Path=/account
→ mybank.com/account/... 요청에만 쿠키를 보냄
→ mybank.com/blog 요청에는 안 보냄
```

**HttpOnly — JavaScript 접근 차단**

```
HttpOnly가 켜져 있으면:
→ document.cookie로 읽을 수 없음
→ 브라우저 → 서버 통신에서만 자동으로 붙음
→ 악성 스크립트가 쿠키를 훔칠 수 없음 (XSS 방어)
```

만약 악성 코드가 페이지에 삽입돼서 `document.cookie`를 읽어 공격자 서버로 보내려 해도, HttpOnly 쿠키는 JS에서 아예 안 보인다.

**Secure — HTTPS에서만**

```
Secure 플래그가 켜져 있으면:
→ https://mybank.com에만 쿠키를 보냄
→ http://mybank.com에는 안 보냄
→ 중간에 네트워크를 엿듣는 사람이 쿠키를 못 봄
```

**Max-Age / Expires — 유효기간**

```
Max-Age=3600  → 1시간 뒤 쿠키 삭제
Expires 없음  → 브라우저 닫으면 삭제 (세션 쿠키)
```

**SameSite — CSRF 방어의 핵심. 뒤에서 자세히.**

---

## CSRF — "알아서 붙이는" 쿠키가 만든 구멍

쿠키의 자동 전송이 문제가 되는 시나리오를 하나하나 따라가보자.

**전제 조건:**
1. 내가 mybank.com에 로그인한 상태다.
2. 브라우저에 mybank.com의 세션 쿠키가 저장돼 있다.
3. 브라우저 탭을 하나 더 열어 다른 사이트를 돌아다닌다.

**장면 1 — evil.com에 들어간다**

검색하다가 낚시 사이트를 클릭했다. evil.com 페이지가 열린다. 이 페이지의 HTML에 이런 코드가 숨어 있다:

```html
<!-- evil.com의 페이지 안에 숨겨진 코드 -->
<img src="https://mybank.com/transfer?to=hacker&amount=1000000" />
```

또는 JavaScript로:

```javascript
// evil.com의 스크립트
fetch('https://mybank.com/api/transfer', {
  method: 'POST',
  body: JSON.stringify({ to: 'hacker', amount: 1000000 }),
  credentials: 'include'   // 쿠키를 포함시키겠다는 뜻
});
```

**장면 2 — 브라우저가 mybank.com으로 요청을 보낸다**

evil.com의 코드가 mybank.com으로 요청을 만들었다. 그리고 여기서 결정적인 일이 일어난다.

```
evil.com의 JS → mybank.com/api/transfer 요청 발생
브라우저: "mybank.com으로 가는 요청이네. mybank.com 쿠키가 있나 보자..."
         "있네! sessionId=session_abc"
         → Cookie: sessionId=session_abc 를 자동으로 붙임
```

브라우저는 **요청이 어디서 시작됐는지 신경 안 쓴다.** mybank.com으로 가는 요청이면 mybank.com의 쿠키를 붙인다. evil.com에서 시작된 요청이든, mybank.com에서 시작된 요청이든 상관없이.

**장면 3 — 서버는 정상 요청으로 착각한다**

```
mybank.com 서버:
  "sessionId=session_abc? 아, jeon이 보낸 송금 요청이구나."
  → 100만 원 송금 실행

  서버 입장에서는 정상적인 요청과 구분할 수 없다.
  쿠키가 맞으니까.
```

이게 **CSRF(Cross-Site Request Forgery)** — 사이트 간 요청 위조다. 악성 사이트가 나 대신 요청을 보내고, 브라우저가 쿠키를 자동으로 붙여서, 서버가 내가 보낸 줄 아는 것.

```
전체 흐름:

내가 mybank.com에 로그인 → 쿠키 저장됨
         ↓
evil.com 방문 → 악성 코드 실행
         ↓
evil.com → mybank.com/transfer 요청 생성
         ↓
브라우저: mybank.com 쿠키를 자동으로 붙임  ← 여기가 문제!
         ↓
mybank.com 서버: "정상 요청이네" → 송금 실행
```

---

## 왜 앱에서는 이 공격이 안 통하나

이걸 이해하면 앱 개발자로서 쿠키의 문제점이 명확해진다.

```
웹:
  evil.com → mybank.com 요청 → 브라우저가 쿠키를 자동으로 붙임 → 서버 속음

앱:
  악성 앱 → mybank API 요청 → ???
  → 쿠키가 없다. 토큰은 내 앱의 SecureStorage에 있다.
  → 악성 앱은 내 앱의 저장소에 접근할 수 없다.
  → 토큰 없이 요청이 가니까 서버가 401 Unauthorized
```

앱은 토큰을 **수동으로** 관리하니까, 다른 앱이 내 토큰을 가져다 쓸 수 없다. 각 앱의 저장소는 운영체제가 격리해주니까.

브라우저는 쿠키를 **자동으로** 관리하니까, evil.com에서 mybank.com으로 요청만 만들면 브라우저가 알아서 쿠키를 끼워넣는다. 사이트 간 격리가 쿠키에는 적용되지 않았던 것.

```
앱의 토큰:   다른 앱이 접근 불가  → CSRF 불가능
브라우저 쿠키: 다른 사이트가 요청만 만들면 자동 첨부 → CSRF 가능
```

---

## SameSite — 뒤늦게 온 해결책

CSRF가 문제가 된 지 한참 지나서, 브라우저에 `SameSite`라는 쿠키 옵션이 추가됐다. "이 쿠키를 다른 사이트에서 온 요청에도 붙일 거냐?"를 제어하는 옵션.

```
Set-Cookie: sessionId=abc; SameSite=Strict
→ 같은 사이트에서 시작된 요청에만 쿠키를 붙인다
→ evil.com에서 mybank.com으로 보내는 요청? 쿠키 안 붙임!

Set-Cookie: sessionId=abc; SameSite=Lax
→ "느슨한" 모드. 링크 클릭(GET)은 허용, POST는 차단
→ evil.com에서 mybank.com 링크를 클릭하면 쿠키 붙임 (페이지 이동이니까)
→ evil.com에서 mybank.com으로 POST 요청? 쿠키 안 붙임!

Set-Cookie: sessionId=abc; SameSite=None; Secure
→ 예전처럼 다른 사이트 요청에도 쿠키를 붙임
→ 반드시 Secure(HTTPS)와 함께 써야 함
```

2020년부터 대부분의 브라우저가 `SameSite=Lax`를 기본값으로 설정했다. 별도로 지정하지 않으면 Lax가 적용되니까, 옛날보다는 CSRF가 훨씬 어려워졌다.

```
evil.com에서 mybank.com으로 POST 요청:

SameSite 이전:
  쿠키 자동 첨부 → 서버 속음 → CSRF 성공

SameSite=Lax (현재 기본):
  쿠키 안 붙음 → 서버: "로그인 안 한 사용자네" → 401 → CSRF 실패
```

---

## SameSite만 믿으면 구멍이 남는다

SameSite가 많은 걸 막아주지만, 방어를 이것 하나에만 의존하면 안 된다. 실전에서는 여러 겹으로 막는다.

**CSRF 토큰 — 서버가 숙제를 내준다**

```
1. 서버가 페이지를 보낼 때 랜덤 토큰을 같이 보낸다
   <form>
     <input type="hidden" name="csrf_token" value="x7k9m2..." />
     <button>송금</button>
   </form>

2. 사용자가 폼을 제출하면 이 토큰이 같이 간다
   POST /transfer
   Body: { to: "friend", amount: 50000, csrf_token: "x7k9m2..." }

3. 서버가 토큰을 검증한다
   "이 토큰이 내가 이 사용자에게 발급한 게 맞나?" → 맞으면 처리
```

evil.com은 이 토큰을 모른다. mybank.com의 페이지에 숨어 있는 값이니까. evil.com에서 요청을 만들어도 올바른 csrf_token을 넣을 수 없다.

```
evil.com이 CSRF 시도:
  POST /transfer { to: "hacker", amount: 1000000 }
  → csrf_token이 없거나 틀림
  → 서버: "토큰이 안 맞네. 위조된 요청!" → 거부
```

**Referer/Origin 헤더 검사**

```
mybank.com에서 시작된 요청:
  Origin: https://mybank.com    ← 서버가 확인

evil.com에서 시작된 요청:
  Origin: https://evil.com      ← "이거 우리 사이트가 아닌데?" → 거부
```

서버가 요청의 출처를 확인하는 방법이다. 다만 일부 상황에서 Origin 헤더가 안 붙는 경우가 있어서 이것만 쓰면 안 된다.

**실전에서는 겹겹이 막는다:**

```
방어 1: SameSite=Lax (브라우저가 쿠키 안 붙임)
방어 2: CSRF 토큰 (서버가 요청 위조 검증)
방어 3: Origin 헤더 확인 (요청 출처 확인)

→ 세 개를 다 뚫어야 공격 성공. 하나만 뚫리면 나머지가 막아줌.
```

---

## 쿠키 vs 토큰 — 각각 다른 구멍이 있다

웹에서 인증하는 방식이 쿠키만 있는 건 아니다. 앱 개발자에게 익숙한 토큰 방식도 웹에서 쓴다.

```
쿠키 기반 인증:
  서버 → Set-Cookie → 브라우저 저장 → 매 요청 자동 전송
  상태를 서버가 관리 (세션 저장소)

토큰 기반 인증 (JWT 등):
  서버 → 토큰을 응답 본문에 담음 → JS가 저장 (localStorage 등) → 매 요청 수동 전송
  상태를 클라이언트가 관리 (토큰 안에 정보 포함)
```

```
              쿠키                    토큰
저장         브라우저가 알아서         JS가 직접 (localStorage 등)
전송         브라우저가 알아서         JS가 직접 (Authorization 헤더)
CSRF 위험    있음 (자동 전송이라서)    없음 (수동 전송이라서)
XSS 위험     HttpOnly면 안전          localStorage면 JS로 탈취 가능
```

둘 다 장단점이 있다. 쿠키는 CSRF에 약하고, 토큰(localStorage)은 XSS에 약하다. 그래서 보안이 중요한 서비스는 보통 `HttpOnly 쿠키 + CSRF 토큰`을 같이 쓴다. HttpOnly로 XSS를 막고, CSRF 토큰으로 CSRF를 막는 조합.

---

## Flutter 개발자가 이걸 알면 뭐가 다른가

"난 앱 개발자인데 쿠키를 왜 알아야 해?" 할 수 있는데, 생각보다 마주치는 상황이 있다.

### WebView에서 쿠키를 만난다

앱 안에 WebView를 넣는 순간 쿠키의 세계에 들어온다.

```dart
// WebView에서 로그인 페이지를 띄우는 경우
WebView(
  initialUrl: 'https://myservice.com/login',
  // 웹 로그인 성공 → 서버가 Set-Cookie로 세션 쿠키를 보냄
  // → WebView 내부에 쿠키가 저장됨
)
```

WebView에서 로그인하고 나서, 이 세션을 네이티브 앱에서도 써야 할 때가 있다. 그러면 WebView의 쿠키를 꺼내와야 한다.

```dart
// WebView에서 쿠키를 꺼내는 예시
final cookieManager = WebviewCookieManager();
final cookies = await cookieManager.getCookies('https://myservice.com');
final sessionId = cookies
    .firstWhere((c) => c.name == 'sessionId')
    .value;
// 이걸 앱의 API 클라이언트에 세팅
```

쿠키가 뭔지 모르면 이런 코드를 쓸 때 "이게 뭘 하는 거지?" 하고 막막하다. Set-Cookie, Domain, HttpOnly 같은 개념을 알면 "아, 서버가 Set-Cookie로 준 세션 ID를 WebView가 들고 있으니까 그걸 꺼내는 거구나" 하고 바로 이해됨.

### OAuth 소셜 로그인에서 쿠키가 동작한다

카카오, 구글 로그인을 붙일 때 뒤에서 쿠키가 돌아간다.

```
내 앱 → 카카오 로그인 페이지 (WebView/브라우저)
     → 사용자가 카카오에 로그인
     → 카카오 서버가 쿠키로 세션 유지
     → 인가 코드 발급 → 내 앱으로 리다이렉트
```

"카카오 계정으로 이미 로그인돼 있으면 바로 넘어가는" 경험이 쿠키 덕분이다. 카카오 도메인의 쿠키가 브라우저에 남아 있어서 다시 로그인 안 해도 되는 것.

### Flutter Web 빌드에서는 앱과 다른 세상이다

같은 Flutter 코드를 `flutter build web`으로 빌드하면 브라우저 위에서 돌아간다. 이때는 앱이 아니라 웹의 규칙을 따른다.

```
Flutter 모바일:
  Dio → 직접 소켓 → 토큰을 직접 관리 → CSRF 걱정 없음

Flutter 웹:
  Dio → 브라우저의 fetch/XHR → 쿠키가 자동 관리될 수 있음
  → CORS 제약, SameSite 정책 등이 적용됨
```

백엔드가 쿠키 기반 인증을 쓰는데 Flutter 웹에서 API를 호출하면, [[소켓 vs HTTP|모바일과 웹의 네트워킹 차이]]와 마찬가지로 다르게 동작할 수 있다. `credentials: 'include'` 설정이 필요하거나, CORS 정책 때문에 쿠키가 안 붙거나 하는 상황이 생기는데, 쿠키의 동작 원리를 알면 원인을 금방 찾는다.

---

## 한 장면으로 기억하기

```
카페 단골 시스템:

HTTP = 기억력 없는 바리스타
쿠키 = 바리스타가 써준 쪽지 "이 손님은 단골, 아메리카노 좋아함"
        → 손님이 올 때마다 쪽지를 보여주면 바리스타가 기억을 되찾음

CSRF = 다른 카페 직원이 내 쪽지를 복사해서
        "이 손님이 케이크 10개 주문했대"라고 거짓말하는 것
        → 바리스타는 쪽지가 진짜니까 믿어버림

SameSite = "이 쪽지는 우리 카페에서 직접 온 손님한테만 적용"
           → 다른 카페에서 가져온 쪽지는 무시
```

---

## 참고

- [[소켓 vs HTTP]] — 브라우저가 네트워크를 감추는 이유, Same-Origin Policy와 CORS
- [MDN — HTTP Cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies) — 쿠키 스펙의 공식 레퍼런스
- [OWASP — CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) — CSRF 방어 기법 정리
