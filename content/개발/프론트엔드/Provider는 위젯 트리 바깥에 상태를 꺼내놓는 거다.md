---
title: "Provider는 위젯 트리 바깥에 상태를 꺼내놓는 거다"
tags:
  - flutter
  - riverpod
  - provider
  - state-management
  - architecture
---

## 상태가 위젯 안에 갇혀있으면 생기는 일

Flutter 처음 배우면 `StatefulWidget` 안에 변수를 만든다. 카운터 앱 생각해보자.

```dart
class CounterPage extends StatefulWidget {
  @override
  State<CounterPage> createState() => _CounterPageState();
}

class _CounterPageState extends State<CounterPage> {
  int count = 0;  // 상태가 여기 살고 있음

  @override
  Widget build(BuildContext context) {
    return Text('$count');
  }
}
```

이 `count`는 `CounterPage` 안에 갇혀있다. 다른 위젯이 이 값을 쓰고 싶으면? 방법이 없다. 생성자로 넘기는 수밖에.

```
       App
        │
    MainPage ← count를 여기서 들고 있어야 함
    ┌───┴───┐
 Header   Body  ← 둘 다 count가 필요하면?
    │       │
 CountText  Button ← 이 버튼이 count를 바꿔야 하면?
```

`count`를 `MainPage`에 올리고, `Header`한테 넘기고, `Body`한테 넘기고, `Body`는 다시 `Button`한테 콜백을 넘기고... 이게 **prop drilling**이다. 택배 기사가 직접 배달 못 하고 옆집, 옆옆집을 거쳐서 전달하는 거랑 같다.

```dart
// 이런 코드가 5단계씩 이어진다
MainPage(
  child: Header(
    count: count,  // Header는 그냥 지나가는 거임
    child: CountText(count: count),
  ),
  body: Body(
    onIncrement: () => setState(() => count++),  // 콜백도 내려보냄
    child: Button(onPressed: onIncrement),
  ),
)
```

위젯이 3~4개면 참을 수 있다. 근데 실제 앱은 위젯이 수십 개다. 인증 상태, 테마, 장바구니, 사용자 정보... 전부 생성자로 내려보내면 코드가 파스타가 된다.

---

## 해결책: 상태를 위젯 트리 밖으로 꺼내자

Provider의 핵심 아이디어는 단순하다. **상태를 특정 위젯이 아니라, 모든 위젯이 접근할 수 있는 별도 공간에 두는 것.**

비유하면 이거다. 원래는 각 방마다 냉장고가 있었다. 거실 냉장고에서 물을 꺼내려면 거실까지 직접 가야 함. 근데 집 한가운데에 공용 냉장고를 하나 놓으면? 어느 방에서든 바로 꺼낼 수 있다.

```
[기존: prop drilling]                    [Provider]
       App                                  App
        │                                    │
    MainPage ← 상태를 들고 있음         ┌── Provider ──┐
    ┌───┴───┐                          │  (공용 냉장고)  │
 Header   Body                         │   count: 0    │
    │       │                          └───────────────┘
 CountText  Button                      어디서든 꺼내 씀
                                       CountText → ref.watch
                                       Button → ref.read
```

중간 위젯들이 택배 중계소 역할을 할 필요가 없어진다. 필요한 위젯이 직접 가져다 쓰면 끝.

---

## Flutter 내장 방식: InheritedWidget

Provider를 이해하려면 그 밑바닥에 뭐가 있는지 알아야 한다. Flutter에는 원래 `InheritedWidget`이라는 게 있다. 위젯 트리 위쪽에 데이터를 꽂아두면 아래쪽 어디서든 꺼내 쓸 수 있게 해주는 메커니즘.

```dart
// 1. 데이터를 담은 InheritedWidget을 만들고
class CountInherited extends InheritedWidget {
  final int count;
  const CountInherited({required this.count, required super.child});

  @override
  bool updateShouldNotify(CountInherited old) => old.count != count;

  static CountInherited of(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<CountInherited>()!;
  }
}

// 2. 트리 위쪽에 배치하면
CountInherited(
  count: 42,
  child: MyApp(),  // MyApp 아래 모든 위젯이 count에 접근 가능
)

// 3. 아래 어디서든 꺼내 씀
final count = CountInherited.of(context).count;
```

동작한다. 근데 보면 알겠지만 보일러플레이트가 너무 많다. 상태 하나 공유하려고 클래스 하나, `of` 메서드, `updateShouldNotify`... 이걸 상태마다 만들어야 함. 이 불편함을 해결하려고 나온 게 Provider 패키지, 그리고 그 진화형인 Riverpod이다.

---

## Riverpod은 이걸 어떻게 바꿨나

Riverpod은 `InheritedWidget`의 한계를 넘어서 아예 위젯 트리와 분리된 상태 컨테이너를 만들었다.

```
[InheritedWidget 방식]              [Riverpod 방식]
위젯 트리 안에 상태가 섞여있음        위젯 트리와 상태가 완전히 분리됨

      App                                App
       │                                  │
  InheritedWidget ← 여기에 데이터       ProviderScope ← 상태 컨테이너의 시작점
       │                                  │
    MyPage                             MyPage
       │                                  │
    MyButton                           MyButton → ref.watch(counterProvider)
                                                   ↑
                                           상태 컨테이너
                                         ┌──────────────┐
                                         │ counterProv.  │
                                         │ authProv.     │
                                         │ themeProv.    │
                                         └──────────────┘
```

핵심 차이가 뭐냐면:

- **InheritedWidget**: 위젯 트리에 상태를 끼워넣는다. BuildContext에 의존함
- **Riverpod**: 상태를 아예 별도 컨테이너에 둔다. 위젯 없이도 Provider끼리 서로 참조 가능

Riverpod에서는 Provider를 선언하고, 위젯에서 `ref`로 읽는다. 이 두 단계가 전부.

---

## Provider 선언 — 상태를 만드는 쪽

Provider를 선언하는 건 "이런 상태가 있어, 초기값은 이거야"라고 알리는 거다.

### 가장 단순한 형태: 값 하나 제공

```dart
@riverpod
String greeting(ref) {
  return '안녕하세요';
}
```

함수 하나가 Provider 하나다. 이 함수가 리턴하는 값이 곧 상태. 외부에서 `ref.watch(greetingProvider)`로 읽으면 `'안녕하세요'`가 나옴.

### 비동기 데이터 가져오기

서버에서 데이터를 받아와야 하는 경우. Future를 리턴하면 된다.

```dart
@riverpod
Future<List<Post>> postList(ref) async {
  final response = await dio.get('/posts');
  return response.data.map((e) => Post.fromJson(e)).toList();
}
```

이게 `FutureProvider`다. 로딩, 에러, 데이터 상태를 자동으로 관리해준다. 위젯에서는 이렇게 씀:

```dart
final postsAsync = ref.watch(postListProvider);

return postsAsync.when(
  loading: () => CircularProgressIndicator(),
  error: (e, st) => Text('에러: $e'),
  data: (posts) => ListView(children: posts.map(PostCard.new).toList()),
);
```

`when`이 로딩/에러/성공 세 가지 상태를 깔끔하게 분기해준다. `isLoading` 변수 따로 만들고, `try-catch` 감싸고 할 필요 없음.

### 상태를 바꿀 수 있는 Provider: Notifier

위의 두 예시는 읽기 전용이다. 상태를 변경하려면 `Notifier`를 쓴다.

```dart
@riverpod
class Counter extends _$Counter {
  @override
  int build() => 0;  // 초기값

  void increment() {
    state = state + 1;  // state를 직접 변경
  }

  void reset() {
    state = 0;
  }
}
```

`build()`가 초기값을 정하고, 메서드들이 `state`를 변경한다. 위젯에서는:

```dart
// 값 읽기
final count = ref.watch(counterProvider);

// 메서드 호출
ref.read(counterProvider.notifier).increment();
```

### 비동기 + 상태 변경: AsyncNotifier

서버에서 데이터를 받아오면서, 그 데이터를 수정할 수도 있어야 할 때.

```dart
@riverpod
class TodoList extends _$TodoList {
  @override
  Future<List<Todo>> build() async {
    return await repository.fetchAll();
  }

  Future<void> addTodo(String title) async {
    await repository.add(title);
    ref.invalidateSelf();  // 다시 build() 실행 → 목록 새로고침
  }
}
```

처음에 서버에서 목록을 불러오고(`build`), 추가 버튼을 누르면 서버에 저장한 뒤 목록을 갱신한다(`addTodo`). `ref.invalidateSelf()`가 "나 자신을 무효화해서 다시 빌드해"라는 뜻.

---

## Provider 소비 — 상태를 읽는 쪽

선언이 "만드는 쪽"이면, 소비는 "쓰는 쪽"이다. 세 가지 방법이 있고, 각각 용도가 다르다.

### ref.watch — 값이 바뀌면 다시 그려

```dart
@override
Widget build(BuildContext context, WidgetRef ref) {
  final count = ref.watch(counterProvider);
  return Text('$count');
}
```

`watch`는 구독이다. `count`가 바뀔 때마다 이 위젯의 `build`가 다시 실행됨. UI에 상태를 표시할 때 거의 항상 이걸 쓴다.

### ref.read — 지금 값만 한 번 읽기

```dart
onPressed: () {
  ref.read(counterProvider.notifier).increment();
}
```

`read`는 일회성 읽기다. 구독 안 함. 버튼 클릭처럼 "이 순간에만 값이 필요한" 상황에서 쓴다. `build` 안에서 `ref.read`를 쓰면 상태가 바뀌어도 UI가 안 바뀌니까 주의.

### ref.listen — 값이 바뀔 때 콜백 실행

```dart
ref.listen(authProvider, (previous, next) {
  if (next == AuthState.loggedOut) {
    context.go('/login');
  }
});
```

`listen`은 "값이 바뀌면 이 함수를 실행해줘"다. UI를 다시 그리는 게 아니라, 네비게이션이나 스낵바 같은 부수효과를 처리할 때 씀.

### 정리

```
┌─────────────┬────────────────────────────────────────┐
│   메서드     │  언제 쓰나                              │
├─────────────┼────────────────────────────────────────┤
│ ref.watch   │ UI에 값을 표시할 때 (build 안에서)        │
│ ref.read    │ 버튼 클릭 등 이벤트 핸들러에서            │
│ ref.listen  │ 값 변경 시 네비게이션, 스낵바 등 부수효과   │
└─────────────┴────────────────────────────────────────┘
```

---

## Provider끼리 연결된다

Provider의 진짜 힘은 Provider끼리 의존할 수 있다는 거다.

```dart
// 1. 인증 상태
@Riverpod(keepAlive: true)
class Auth extends _$Auth {
  @override
  AuthState build() => AuthState.loggedOut();

  void login(String token) {
    state = AuthState.loggedIn(token);
  }
}

// 2. 인증 토큰을 사용하는 API 클라이언트
@riverpod
ApiClient apiClient(ref) {
  final auth = ref.watch(authProvider);
  return ApiClient(token: auth.token);
}

// 3. API 클라이언트를 사용하는 데이터 조회
@riverpod
Future<List<Order>> orderList(ref) async {
  final client = ref.watch(apiClientProvider);
  return await client.get('/orders');
}
```

```
authProvider → apiClientProvider → orderListProvider
   (토큰)          (토큰 넣은 클라이언트)     (주문 목록)
```

`authProvider`의 토큰이 바뀌면? `apiClientProvider`가 자동으로 다시 만들어지고, `orderListProvider`도 자동으로 다시 fetch한다. 도미노처럼 연쇄적으로 갱신됨. 이걸 수동으로 관리하면 "토큰 바뀌었으니 API 클라이언트 다시 만들고, 주문 목록도 다시 불러오고..." 코드를 여기저기 흩뿌려야 한다.

---

## Family — 같은 Provider인데 인자가 다른 경우

상품 상세 페이지를 생각해보자. 상품마다 다른 데이터를 가져와야 하는데, Provider의 로직은 동일하다.

```dart
@riverpod
Future<Product> productDetail(ref, String productId) async {
  return await repository.getProduct(productId);
}
```

인자를 넣으면 자동으로 Family Provider가 된다. 같은 로직이지만 `productId`에 따라 별도 인스턴스가 생김.

```dart
// 각각 다른 인스턴스
ref.watch(productDetailProvider('abc'));
ref.watch(productDetailProvider('xyz'));
```

```
productDetailProvider('abc') → Product(name: '신발')     ← 별도 인스턴스
productDetailProvider('xyz') → Product(name: '모자')     ← 별도 인스턴스
```

'abc' 상품의 상세 페이지를 열면 'abc' 인스턴스만 생기고, 'xyz' 상품과는 완전히 독립적이다. [[Riverpod AutoDispose, 언제 꺼지고 언제 살려야 하는가]]에서 말한 것처럼, 이 각각의 인스턴스가 AutoDispose 대상이 된다. 'abc' 상세 페이지를 닫으면 'abc' 인스턴스만 정리됨.

---

## 어떤 Provider를 써야 하나 — 판단 흐름

```
상태를 바꿀 수 있어야 하나?
├── 아니오 → 동기? 비동기?
│            ├── 동기: 함수형 Provider     (설정값, 계산된 값)
│            └── 비동기: FutureProvider    (서버에서 데이터 읽기만)
│
└── 예 → 초기 로드가 비동기인가?
         ├── 아니오: Notifier            (카운터, 폼, 토글)
         └── 예: AsyncNotifier          (목록 CRUD, 서버 데이터 + 수정)
```

실전에서 자주 쓰는 조합:

| 상황 | Provider 타입 | 예시 |
|------|-------------|------|
| 서버에서 목록 불러오기만 | 함수형 (Future) | 공지사항 목록, 배너 목록 |
| 서버 목록 + 추가/삭제 | AsyncNotifier | 장바구니, 할일 목록 |
| 로컬 상태 관리 | Notifier | 폼 입력, 탭 인덱스, 필터 |
| 앱 전역 상태 | Notifier + keepAlive | 인증, 테마, 알림 설정 |
| 다른 Provider 조합 | 함수형 | 필터링된 목록, 파생 상태 |

---

## 실전 패턴: 검색 화면 하나 만들어보기

실제로 검색 화면을 Provider로 어떻게 구성하는지 처음부터 따라가보자.

```dart
// 1. 검색 결과를 관리하는 Provider
@riverpod
class SearchViewModel extends _$SearchViewModel {
  @override
  AsyncValue<List<Item>> build() => const AsyncData([]);

  Future<void> search(String query) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => repository.search(query),
    );
  }
}
```

`AsyncValue.guard`가 try-catch를 대신한다. 성공하면 `AsyncData`, 예외가 나면 `AsyncError`로 자동 감싸줌.

```dart
// 2. 위젯에서 사용
class SearchPage extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final searchState = ref.watch(searchViewModelProvider);

    return Column(
      children: [
        TextField(
          onSubmitted: (query) {
            ref.read(searchViewModelProvider.notifier).search(query);
          },
        ),
        Expanded(
          child: searchState.when(
            loading: () => Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: Text('검색 실패')),
            data: (items) => ListView.builder(
              itemCount: items.length,
              itemBuilder: (_, i) => ListTile(title: Text(items[i].name)),
            ),
          ),
        ),
      ],
    );
  }
}
```

`watch`로 상태를 구독하고, `read`로 메서드를 호출한다. `searchState.when`이 로딩/에러/데이터를 깔끔하게 분기함. 이 패턴 하나면 대부분의 화면을 커버할 수 있다.

---

## ConsumerWidget vs StatelessWidget

Provider를 쓰려면 위젯이 `ref`에 접근할 수 있어야 한다. 방법은 두 가지.

```dart
// 방법 1: ConsumerWidget (StatelessWidget 대체)
class MyPage extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(counterProvider);
    return Text('$count');
  }
}

// 방법 2: Consumer (부분만 감싸기)
class MyPage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text('여기는 리빌드 안 됨'),
        Consumer(builder: (context, ref, child) {
          final count = ref.watch(counterProvider);
          return Text('$count');  // 여기만 리빌드
        }),
      ],
    );
  }
}
```

`ConsumerWidget`은 위젯 전체가 리빌드된다. `Consumer`는 감싼 부분만 리빌드. 성능이 중요한 곳에서는 `Consumer`로 범위를 좁혀주면 좋다. 다만 대부분의 경우 `ConsumerWidget`으로 충분함. Flutter 자체가 리빌드에 최적화되어 있어서, 진짜 병목이 되는 경우가 아니면 미리 최적화할 필요 없다.

---

## ProviderScope — 모든 것의 시작점

앱 최상위에 `ProviderScope`를 감싸야 Provider가 동작한다.

```dart
void main() {
  runApp(
    ProviderScope(
      child: MyApp(),
    ),
  );
}
```

이게 "공용 냉장고를 설치한다"에 해당하는 코드다. 이 한 줄이 없으면 `ref.watch`가 동작하지 않음. `ProviderScope`가 모든 Provider의 상태를 보관하는 컨테이너를 만들어준다.

---

## 삽질에서 건진 것들

`build` 안에서 `ref.read`를 썼더니 상태가 바뀌어도 UI가 안 바뀌었다. `read`는 구독이 아니라 스냅샷이라서 그렇다. UI에 표시하는 값은 반드시 `ref.watch`. 이벤트 핸들러에서만 `ref.read`.

Provider 안에서 다른 Provider를 `ref.read`로 읽었더니 값이 오래된 채로 고정됐다. Provider끼리 연결할 때는 `ref.watch`를 써야 상위 Provider가 바뀔 때 자동으로 갱신된다. `read`로 읽으면 처음 값만 가져가고 그 뒤로 변화를 못 따라감.

`ProviderScope`를 까먹고 안 감쌌는데 에러 메시지가 뜬금없었다. "Bad state: No ProviderScope found" — 이게 나오면 `main.dart`의 `runApp` 감싸기부터 확인하자.

상태 변경 후 UI가 즉시 안 바뀌는 것 같아서 `setState`를 같이 쓴 적이 있다. Provider와 `setState`는 같이 쓰면 안 된다. 상태 관리 주체가 둘이 되면 누가 진실인지 모르게 됨. Provider를 쓰기로 했으면 `state = newValue`만으로 UI가 알아서 갱신된다.
