---
title: "푸시 알람을 화면에서 열기까지"
tags:
  - flutter
  - fcm
  - push-notification
  - gorouter
  - navigation
  - deep-linking
---

> Flutter에서 FCM 푸시 알림을 받고, 특정 페이지로 이동시키는 전체 과정.
> 어떤 프로젝트든 구조는 같다.

---

## 서버가 보내는 건 두 겹짜리 봉투다

FCM 메시지에는 두 가지 층이 있다. `notification`과 `data`.

`notification`은 봉투 겉면이다. 사용자 눈에 보이는 제목, 본문, 이미지. OS가 이걸 읽어서 알림 센터에 띄운다.

`data`는 봉투 안에 든 편지다. 앱 코드만 읽을 수 있고, 여기에 적힌 내용이 "어디로 갈지"를 결정한다.

```
┌─────────────────────────────────┐
│  notification (겉면)             │
│  ├─ title: "새 기사가 도착했어요"   │
│  └─ body:  "지금 확인해보세요"     │
│                                 │
│  data (편지)                     │
│  ├─ type: "article"             │
│  └─ article_id: "12345"         │
└─────────────────────────────────┘
```

핵심 원칙: **앱의 행동을 결정하는 건 `data`지, `notification`이 아니다.**

제목에 "긴급 뉴스"라고 써 있어도 `data.type`이 `"article"`이면 기사 상세 페이지로 간다. 제목은 사람을 위한 것이고, `data`는 코드를 위한 것이다. 이 둘을 혼동하면 디버깅할 때 한참 헤맨다.

---

## 앱 상태에 따라 알림이 도착하는 길이 다르다

같은 FCM 메시지라도 앱이 어떤 상태냐에 따라 완전히 다른 경로를 탄다. 세 가지 장면이 있다.

### 사용자가 앱을 보고 있을 때

사용자가 앱을 쓰고 있는데 알림이 도착한다. 이때 FCM은 시스템 알림을 **띄우지 않는다.** 포그라운드에서는 OS가 알림 배너를 자동으로 만들어주지 않는다는 뜻이다. 아무것도 안 하면 사용자는 알림이 온 줄 모른다.

그래서 앱이 직접 로컬 알림을 만들어서 보여줘야 한다:

```dart
FirebaseMessaging.onMessage.listen((RemoteMessage message) {
  // FCM 메시지를 받아서 flutter_local_notifications로 직접 표시
  _showLocalNotification(message);
});
```

사용자가 이 로컬 알림을 탭하면 `onDidReceiveNotificationResponse` 콜백이 호출된다.

여기서 주의할 점이 있다. 이 콜백에서 받는 건 `RemoteMessage` 객체가 아니라 **로컬 알림을 만들 때 넣어둔 payload 문자열**이다. 원본 `RemoteMessage`의 `sentTime`이나 `messageId` 같은 메타 정보는 이 변환 과정에서 사라진다.

나중에 "알림 발송 시각"이 필요하다면 로컬 알림 payload에 미리 심어놓아야 한다:

```dart
// 로컬 알림 생성 시
await flutterLocalNotificationsPlugin.show(
  id, title, body, details,
  payload: jsonEncode({
    ...message.data,
    'received_at': DateTime.now().toIso8601String(),  // 나중에 쓸 시각 정보
  }),
);
```

### 앱이 백그라운드에 있을 때

사용자가 다른 앱을 쓰고 있을 때 알림이 온다. OS가 `notification` 필드를 읽어서 시스템 알림을 자동으로 띄운다. 사용자가 그 알림을 탭하면 앱이 포그라운드로 올라오고, 리스너가 호출된다:

```dart
FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
  handleNotificationClick(message);
});
```

이 경우에는 `RemoteMessage`를 온전히 받는다. `sentTime`, `data`, `messageId` 모두 사용할 수 있다.

### 앱이 완전히 꺼져 있을 때

사용자가 자는 동안 알림이 온다. 아침에 알림을 탭하면 앱이 처음부터 부팅된다.

이때 `onMessageOpenedApp`은 호출되지 않는다. 앱이 살아있지 않았으니 리스너가 등록된 적이 없기 때문이다. 대신 앱 시작 시 `getInitialMessage()`로 "나를 깨운 알림"을 꺼내올 수 있다:

```dart
final initialMessage = await FirebaseMessaging.instance.getInitialMessage();
if (initialMessage != null) {
  handleNotificationClick(initialMessage);
}
```

한 번 읽으면 소진된다. 두 번 호출하면 두 번째는 null이다.

### 정리하면

```
포그라운드   onMessage → 로컬 알림 직접 표시 → 탭 시 onDidReceiveNotificationResponse
백그라운드   OS가 자동 표시                 → 탭 시 onMessageOpenedApp
종료 상태   OS가 자동 표시                 → 탭 시 getInitialMessage (앱 부팅 후)
```

세 갈래 모두 결국 하나의 `handleNotificationClick()`으로 합류시키면 된다. 다만 포그라운드만 payload 형태가 다르니까(문자열 vs RemoteMessage) 파싱을 분리해야 한다.

---

## data를 읽고 갈 곳을 정한다

세 경로가 합류한 후에는 `data.type`을 보고 어디로 보낼지 정한다:

```dart
void handleNotificationClick(Map<String, dynamic> data) {
  final type = data['type'];
  final targetId = data['article_id'];

  switch (type) {
    case 'top_articles':
      goToTab(0);                       // 특정 탭으로 이동
    case 'article' when targetId != null:
      goToTab(1);                       // 목록 탭으로 이동
      scrollToArticle(targetId);        // + 해당 기사까지 스크롤
    default:
      // 처리할 수 없는 type → 무시하거나 홈으로
  }
}
```

이 분기 로직이 클라이언트 라우팅의 전부다. 서버가 `data`에 뭘 넣느냐가 앱의 동작을 100% 결정한다.

---

## GoRouter에서 탭을 외부에서 전환하는 법

GoRouter의 `StatefulShellRoute`를 쓰면 하단 탭 네비게이션을 선언적으로 구성할 수 있다. 문제는 **알림 핸들러 같은 외부 코드에서 탭을 전환**해야 할 때다.

탭 전환에는 `StatefulNavigationShell.goBranch(index)`를 쓴다. 이 객체를 라우터 빌드 시점에 전역으로 저장해두면 어디서든 접근할 수 있다:

```dart
// 라우터 설정
StatefulShellRoute.indexedStack(
  builder: (context, state, navigationShell) {
    NavigationHelper.shell = navigationShell;  // 전역 저장
    return ScaffoldWithNavBar(child: navigationShell);
  },
  branches: [
    StatefulShellBranch(routes: [GoRoute(path: '/home', ...)]),
    StatefulShellBranch(routes: [GoRoute(path: '/feed', ...)]),
    StatefulShellBranch(routes: [GoRoute(path: '/settings', ...)]),
  ],
)

// 어디서든 탭 전환
NavigationHelper.shell?.goBranch(1);  // feed 탭으로 전환
```

`goBranch()`는 내부적으로 GoRouter를 통해 해당 브랜치 경로로 이동한다. 그러니까 `goBranch(1)` 호출 후에 `GoRouter.of(context).go('/feed')`를 또 호출하면 **이중 네비게이션**이 되어 화면이 꼬인다. 둘 중 하나만 써야 한다.

---

## 앱이 꺼진 상태에서 열릴 때 생기는 타이밍 문제

앱 종료 상태에서 알림을 탭하면, 앱이 부팅되면서 동시에 네비게이션을 시도해야 한다. 문제는 **위젯 트리가 아직 빌드되지 않았을 때 네비게이션을 시도할 수 있다**는 것이다.

```
앱 부팅 순서:

1. main() 실행
2. 의존성 초기화 (DI, Firebase 등)
3. runApp() 호출          ← 위젯 트리 빌드 "시작". 아직 화면은 안 그려짐.
4. FCM 초기화
   └─ getInitialMessage()
        └─ handleNotificationClick()
             └─ goToBranch(1)
                  └─ shell 객체가 아직 null!
```

`runApp()` 직후에는 `StatefulShellRoute.builder`가 아직 실행되지 않았다. 첫 프레임이 그려져야 shell 객체가 저장되는데, FCM 초기화가 그보다 빨리 끝나면 shell이 null이다.

해결 패턴:

```dart
static void goToBranch(int index) {
  if (_shell != null) {
    _shell!.goBranch(index);
  } else {
    // 다음 프레임에서 재시도
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_shell != null) {
        _shell!.goBranch(index);
      } else {
        // 최후의 수단: GoRouter.go()로 직접 이동
        GoRouter.of(navigatorKey.currentContext!).go(paths[index]);
      }
    });
  }
}
```

`addPostFrameCallback`은 "다음 프레임이 그려진 직후에 실행해줘"라는 뜻이다. 그때쯤이면 위젯 트리가 빌드되어 shell 객체가 준비되어 있을 확률이 높다.

---

## 알림 탭 → 특정 아이템으로 스크롤하는 패턴

단순히 목록 페이지를 여는 것 이상으로, 특정 아이템까지 자동 스크롤해야 할 때가 있다. 이때 GoRouter의 query parameter보다 **상태 관리(BLoC/Provider 등)에 직접 이벤트를 보내는 게 더 안정적**이다.

```dart
// 1. 탭 전환
goToBranch(1);

// 2. 상태 관리에 "이 아이템을 찾아서 스크롤해"라고 이벤트 전달
bloc.add(ScrollToArticle(targetId: articleId, date: pushDate));
```

BLoC/Provider 쪽에서는 API를 페이지별로 호출하면서 해당 ID를 찾을 때까지 반복한다:

```dart
List<Article> allArticles = [];
int? targetIndex;

for (int page = 1; page <= maxPages; page++) {
  final articles = await repository.getList(page: page, date: date);
  if (articles.isEmpty) break;

  for (int i = 0; i < articles.length; i++) {
    if (articles[i].id == targetId) {
      targetIndex = allArticles.length + i;
      break;
    }
  }
  allArticles.addAll(articles);
  if (targetIndex != null) break;
}

emit(ListLoaded(articles: allArticles, scrollToIndex: targetIndex));
```

UI 쪽은 state의 `scrollToIndex`가 있으면 그 위치로 점프한다. GoRouter query parameter 방식은 같은 경로인데 파라미터만 다를 때 페이지가 리빌드되지 않는 경우가 있어서 이 패턴이 더 확실하다.

---

## 삽질에서 배운 것들

### notification 제목으로 라우팅을 추론하면 안 된다

알림 제목이 "오늘의 추천 뉴스"라고 해서 `type: "recommendation"`이 올 거라고 가정하면 안 된다. 서버의 DB 레코드가 어떤 type으로 저장되어 있느냐가 `data.type`을 결정한다. 관리자 화면에서 제목은 자유롭게 입력할 수 있으니, 제목과 type은 완전히 독립적이다.

디버깅 첫 단계는 항상 **실제 수신된 `data`를 로그로 찍는 것**이다:
```dart
print('push data: ${message.data}');
```

**겉으로 보이는 걸 믿지 말고 실제 데이터를 찍어봐야 한다.**

### goBranch() 다음에 go()를 호출하면 꼬인다

"확실하게 하려고" 둘 다 호출하면 이중 네비게이션이 발생한다. `goBranch()`가 내부적으로 `go()`를 이미 호출하기 때문이다. 하나만 쓰면 된다.

### 포그라운드 알림은 RemoteMessage를 잃는다

`RemoteMessage` → `flutter_local_notifications` → 탭 콜백으로 이어지는 과정에서, 로컬 알림의 payload는 개발자가 직접 넣은 문자열이다. `sentTime`, `messageId` 같은 RemoteMessage 고유 필드는 자동으로 넘어오지 않는다. 필요한 값은 payload에 미리 넣어둬야 한다.

### 찾으려는 아이템이 API 응답에 없을 수 있다

푸시에 담긴 ID가 API 목록 응답에서 빠질 수 있는 이유:
- 서버 쪽 필터링 (삭제됨, 비공개 전환 등)
- 클라이언트 쪽 필터링 (특정 조건의 아이템 제외)
- 날짜 범위 파라미터가 맞지 않음

디버깅할 때 각 페이지의 ID 목록을 찍어보면 바로 확인된다.

---

## 문제가 생겼을 때 따라가는 순서

1. **서버 payload 확인** — 실제로 어떤 `data`가 전송되고 있는지 로그 확인
2. **클라이언트 수신 확인** — `handleNotificationClick`에서 받은 `data` 로그
3. **앱 상태 확인** — 포그라운드/백그라운드/종료 중 어느 경로를 타고 있는지
4. **shell 객체 상태** — 종료 → 재실행 케이스에서 null은 아닌지
5. **이중 네비게이션** — `goBranch()`와 `go()` 동시 호출 여부
6. **타겟 존재 여부** — 스크롤 대상 ID가 API 응답에 실제로 있는지
