---
title: "서버가 API를 호출하는데 문 앞에서 쫓겨날 때"
tags:
  - gcp
  - service-account
  - oauth2
  - scope
  - debugging
  - google-play-api
---

## 서비스 계정은 사람 대신 API를 호출하는 로봇이다

Google Cloud에서 서버가 Google API를 호출하려면 "나 누구야"를 증명해야 한다. 사람이 브라우저에서 로그인하듯, 서버는 서비스 계정(JSON 키 파일)으로 신분을 증명한다.

```
┌────────────┐     ┌────────────────┐     ┌──────────────┐
│  서버       │ ──→ │ Google OAuth2   │ ──→ │ Google API    │
│             │     │ "토큰 발급해줘"  │     │ "구매 검증해줘" │
└────────────┘     └────────────────┘     └──────────────┘
  서비스 계정 키       액세스 토큰 발급         API 호출
  (JSON 파일)        (scope 확인)
```

서비스 계정 키로 토큰을 발급받을 때, "이 토큰으로 어떤 API를 쓸 거야"를 선언하는 게 scope다.

---

## scope는 출입증에 적힌 허용 구역이다

비유하면 이렇다:

- 서비스 계정 키 = 사원증 (신분 증명)
- scope = 출입 가능 구역 (이 사원증으로 어디까지 들어갈 수 있는지)
- API 호출 = 특정 구역에 입장 시도

```
사원증만 있고 출입 구역이 안 적혀 있으면?
→ 신분은 확인되지만, 어느 문도 열리지 않는다 (403)

출입 구역에 "androidpublisher"가 적혀 있으면?
→ Google Play Developer API 문이 열린다 (200)
```

코드로 보면:

```kotlin
// scope 없이 credential 생성 → 어떤 Google API도 호출 불가
GoogleCredentials.create(AccessToken("token", Date()))

// scope 포함해서 credential 생성 → 해당 API만 호출 가능
GoogleCredentials.fromStream(keyFile)
    .createScoped(listOf("https://www.googleapis.com/auth/androidpublisher"))
```

---

## 실제 디버깅 과정

서버 로그에 이렇게만 찍혔다:

```
503 SERVICE_UNAVAILABLE "Google Play API is temporarily unavailable"
```

이것만 보면 Google API가 일시적으로 죽은 것 같다. 근데 실제로는 서버가 모든 Google API 에러를 503으로 변환하고 있었다:

```kotlin
catch (e: GoogleJsonResponseException) {
    throw ResponseStatusException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "Google Play API is temporarily unavailable."  // 실제 원인을 숨김
    )
}
```

403(권한 없음)이든 404(리소스 없음)이든 전부 "일시적 오류"로 바뀌어 나옴. 에러를 뭉뚱그리면 디버깅이 불가능해진다.

---

## 서비스 계정으로 직접 API를 호출해본다

서버를 거치지 않고, 같은 서비스 계정으로 Google API를 직접 호출하면 진짜 에러가 보인다.

```bash
# 1. 서비스 계정으로 로그인 (서버와 같은 신분)
gcloud auth activate-service-account my-service@project.iam.gserviceaccount.com \
  --key-file=service-account-key.json

# 2. 기본 토큰으로 API 호출 (scope 없이)
TOKEN=$(gcloud auth print-access-token)
curl "https://androidpublisher.googleapis.com/..." \
  -H "Authorization: Bearer $TOKEN"
# → 403: ACCESS_TOKEN_SCOPE_INSUFFICIENT

# 3. scope를 명시해서 API 호출
TOKEN=$(gcloud auth print-access-token \
  --scopes="https://www.googleapis.com/auth/androidpublisher")
curl "https://androidpublisher.googleapis.com/..." \
  -H "Authorization: Bearer $TOKEN"
# → 400: Invalid Value (= API 접근은 성공, 요청 데이터가 잘못된 것)
```

같은 서비스 계정, 같은 API인데:
- scope 없이 → 403 (문 앞에서 거절)
- scope 있으면 → 400 (문 안에 들어감, 다른 이유로 실패)

차이점이 scope 하나뿐이니까, 서버도 scope 없이 호출하고 있다는 결론이 나온다.

---

## 서버의 credential이 scope 없이 만들어지는 시나리오

Spring Boot에서 credential을 Bean으로 등록하면, 서버가 시작될 때 한 번만 생성되고 이후 계속 재사용된다.

```kotlin
@Bean
fun credentials(resource: Resource): GoogleCredentials {
    return try {
        GoogleCredentials.fromStream(resource.inputStream)
            .createScoped(listOf("androidpublisher"))  // scope 포함
    } catch (e: Exception) {
        // 키 파일 로드 실패 시 fallback
        GoogleCredentials.create(AccessToken("dummy", Date()))  // scope 없음!
    }
}
```

서버 시작 시 키 파일이 없거나 일시적 IO 에러가 나면 fallback으로 scope 없는 credential이 만들어진다. 이게 Bean으로 캐싱되어서 서버가 꺼질 때까지 계속 사용됨.

서버를 재시작하면 credential이 다시 생성되고, 이번에는 키 파일이 정상 로드되어 scope가 포함된 credential이 만들어진다. 재시작만으로 해결되는 이유가 이거다.

---

## 삽질에서 건진 것들

에러 메시지를 뭉뚱그리면 안 된다. Google API가 403을 줬는데 서버가 503으로 바꿔서 내보내면, 클라이언트 개발자는 "서버가 불안정한가?"라고 잘못된 방향으로 디버깅하게 됨. 최소한 로그에는 원본 에러를 남겨야 한다.

서비스 계정 권한은 세 겹이다:

```
1. GCP IAM 역할    → 프로젝트 내 리소스 접근 권한
2. OAuth2 scope    → API 호출 시 어떤 API를 쓸 수 있는지
3. 외부 서비스 권한  → Play Console, Firebase 등에서 별도 부여
```

1번만 설정하면 되는 게 아니다. scope가 빠지면 IAM 역할이 있어도 API 호출이 거부됨.

`gcloud auth activate-service-account`로 서버와 같은 신분을 흉내 내서, 서버를 안 건드리고도 API 호출을 테스트할 수 있다. 서버 코드를 수정하고 배포하는 것보다 훨씬 빠름.

credential fallback에 dummy 토큰을 넣는 건 최악이다. 키 파일 로드 실패 시 dummy credential로 fallback하면, 서버가 에러 없이 시작되지만 모든 API 호출이 실패하는 상태가 된다. 차라리 서버 시작을 실패시키는 게 낫다. 문제를 빨리 발견할 수 있으니까.

---

## 참고

- [GCP 서비스 계정 문서](https://cloud.google.com/iam/docs/service-accounts)
- [Google OAuth2 Scopes](https://developers.google.com/identity/protocols/oauth2/scopes)
