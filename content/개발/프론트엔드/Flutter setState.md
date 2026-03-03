---
title: "Flutter setState"
tags:
  - flutter
  - setState
  - StatefulWidget
  - widget-lifecycle
  - rendering-pipeline
  - state-management
---

## 화면은 혼자 안 바뀐다

Flutter 앱이 처음 실행되면 위젯 트리를 만들고, 레이아웃을 잡고, 픽셀을 찍는다. 이 과정이 끝나면 화면은 그냥 가만히 있다. 변수값을 바꿔도 화면은 모른다. 누군가 "야, 다시 그려"라고 말해줘야 한다.

```dart
class _CounterState extends State<CounterPage> {
  int count = 0;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: () {
        count++;  // 값은 바뀌었지만...
      },
      child: Text('$count'),  // 화면은 그대로 0
    );
  }
}
```

버튼을 아무리 눌러도 화면의 숫자는 0이다. `count` 변수는 분명히 올라가고 있다. 메모리에서는 1, 2, 3이 되어있다. 근데 Flutter는 "화면을 다시 그려야 한다"는 걸 모른다. `build()`가 다시 호출되지 않으니까.

이때 쓰는 게 `setState`.

```dart
onPressed: () {
  setState(() {
    count++;
  });
}
```

이 한 줄이 "값이 바뀌었으니 다시 그려"라는 신호다.

---

## setState가 실제로 하는 일

많은 사람이 `setState` 안의 콜백이 뭔가 마법적인 일을 한다고 생각한다. 아니다. 콜백 자체는 그냥 즉시 실행되는 함수 호출이다. 진짜 핵심은 콜백 이후에 일어나는 일이다.

```
setState(() { count++; })

  1단계: count++ 실행 (그냥 동기 코드)
  2단계: 이 위젯을 "dirty"로 표시
  3단계: Flutter 엔진에 "다음 프레임에 다시 그려야 해"라고 등록
```

Flutter 프레임워크 내부에서 `setState`는 대략 이렇게 생겼다:

```dart
void setState(VoidCallback fn) {
  fn();                  // 콜백을 먼저 실행하고
  _element.markNeedsBuild();  // 이 위젯을 dirty로 표시
}
```

딱 두 줄이다. `fn()`을 호출해서 상태를 바꾸고, `markNeedsBuild()`를 호출해서 "이 위젯 다시 빌드해야 해"라고 등록한다. 그래서 사실 이렇게 써도 동작은 같다:

```dart
onPressed: () {
  count++;
  setState(() {});  // 빈 콜백
}
```

동작은 같지만 이렇게 쓰면 안 된다. `setState` 안에 상태 변경을 넣는 건 "이 값이 바뀌기 때문에 다시 그리는 거야"라고 의도를 명시하는 거다. 코드 읽는 사람한테 보내는 메시지기도 하다.

---

## dirty와 clean

Flutter는 매 프레임(보통 1/60초)마다 화면을 그릴 수 있다. 근데 모든 위젯을 매번 다 그리진 않는다. 그러면 너무 느리니까.

```
프레임 시작
  │
  ├─ dirty 위젯 목록을 확인한다
  │    ├─ CounterPage → dirty → build() 다시 호출
  │    ├─ AppBar → clean → 건너뜀
  │    └─ BottomNav → clean → 건너뜀
  │
  ├─ 새로 만들어진 위젯 트리와 기존 트리를 비교한다
  ├─ 바뀐 부분만 레이아웃 다시 잡는다
  └─ 바뀐 부분만 화면에 그린다
프레임 끝 → 모든 dirty 위젯이 clean으로 돌아감
```

`setState()`를 호출하면 해당 위젯이 dirty 목록에 들어간다. 다음 프레임이 돌 때 그 위젯의 `build()`가 다시 호출되고, 끝나면 다시 clean이 된다.

중요한 건 — `setState()`를 호출한 즉시 `build()`가 실행되는 게 아니라는 거다. "다음 프레임에 해줘"라고 예약하는 거다. 그래서 `setState()`를 연속으로 여러 번 호출해도 `build()`는 한 번만 실행된다.

```dart
onPressed: () {
  setState(() { count++; });
  setState(() { count++; });
  setState(() { count++; });
  // build()는 3번이 아니라 1번만 호출됨
  // count는 3 올라가있고, 그 상태로 한 번 그림
}
```

이게 Flutter의 효율 전략이다. 상태 변경이 여러 번 일어나도 렌더링은 한 번에 모아서 처리함.

---

## 렌더링 파이프라인 속에서 setState의 위치

좀 더 넓게 보면 Flutter가 화면을 그리는 전체 흐름은 이렇다:

```
사용자 입력 (탭, 스크롤 등)
      │
      ▼
  setState() 호출 → 위젯을 dirty로 표시
      │
      ▼
  ── 다음 프레임 시작 ──
      │
      ▼
  Build 단계: dirty 위젯의 build() 호출
      │        → 새로운 위젯 트리 생성
      │        → 기존 Element 트리와 비교 (reconciliation)
      ▼
  Layout 단계: 크기와 위치 계산
      │         → RenderObject.performLayout()
      ▼
  Paint 단계: 실제 픽셀로 그리기
      │        → RenderObject.paint()
      ▼
  Compositing: GPU로 전송
      │
      ▼
  화면에 표시됨
```

`setState`는 이 파이프라인의 가장 앞단에 있다. "시작해"라고 방아쇠를 당기는 거다. 나머지는 Flutter 엔진이 알아서 한다.

여기서 핵심은 **Build 단계에서 위젯 트리 전체를 새로 만드는 게 아니라, dirty 위젯부터 아래쪽만 다시 빌드한다**는 거다. `CounterPage`의 `setState`가 호출되면 `CounterPage`의 `build()`만 다시 실행되지, `MaterialApp`이나 `Scaffold`까지 다시 만들지 않는다.

---

## StatefulWidget의 구조 — 왜 클래스가 두 개인가

처음 Flutter 배울 때 가장 짜증나는 게 이거다. 위젯 하나 만드는데 클래스를 두 개 써야 함.

```dart
// 클래스 1: 위젯 — 설정서
class CounterPage extends StatefulWidget {
  final String title;
  const CounterPage({required this.title});

  @override
  State<CounterPage> createState() => _CounterPageState();
}

// 클래스 2: State — 실제 살림살이
class _CounterPageState extends State<CounterPage> {
  int count = 0;

  @override
  Widget build(BuildContext context) {
    return Text('${widget.title}: $count');
  }
}
```

왜 이렇게 나눴을까? 비유하자면 StatefulWidget은 **도면**이고 State는 **건물**이다.

```
StatefulWidget (도면)                  State (건물)
┌────────────────────┐              ┌──────────────────┐
│ - immutable (불변)  │ ── 생성 ──▶  │ - mutable (가변)  │
│ - 매번 새로 만들어짐  │              │ - 한 번 만들면 유지  │
│ - 설정값(props)만 보관│              │ - 상태(변수) 보관   │
│                    │              │ - build() 여기 있음│
└────────────────────┘              └──────────────────┘
```

Flutter에서 위젯은 불변(immutable)이다. 부모가 다시 빌드될 때마다 자식 위젯도 새로 만들어진다. `CounterPage(title: '카운터')`가 매번 새 인스턴스로 생겨남. 근데 State는 살아남는다. 위젯이 새로 만들어져도 기존 State 객체를 그대로 재사용한다.

그래서 `count`가 State에 있는 거다. 위젯에 넣으면 부모가 리빌드될 때마다 0으로 초기화돼 버린다. State에 넣어야 부모가 리빌드되어도 값이 보존된다.

---

## State의 생애 주기

State 객체는 태어나고, 살고, 죽는다. 이 흐름을 알아야 `setState`를 어디서 쓸 수 있고 어디서 못 쓰는지 이해된다.

```
createState()
      │
      ▼
  initState()    ← 태어남. 딱 한 번 호출
      │            API 호출, 컨트롤러 초기화 여기서
      ▼
  didChangeDependencies()  ← InheritedWidget이 바뀔 때
      │
      ▼
  build()        ← 화면을 그림. setState마다 다시 호출
      │
      ▼
  didUpdateWidget()  ← 부모가 리빌드해서 새 위젯을 줬을 때
      │                (State는 유지, widget 참조만 교체)
      │
      ▼
  dispose()      ← 죽음. 정리 작업 여기서
                   컨트롤러 dispose, 구독 해제
```

실전에서 자주 쓰는 흐름:

```dart
class _MyPageState extends State<MyPage> {
  late final TextEditingController _controller;
  late final ScrollController _scrollController;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController();
    _scrollController = ScrollController();
    _loadData();  // 초기 데이터 불러오기
  }

  Future<void> _loadData() async {
    final data = await fetchSomething();
    setState(() {
      _items = data;  // 데이터 받으면 화면 갱신
    });
  }

  @override
  void dispose() {
    _controller.dispose();    // 메모리 누수 방지
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      controller: _scrollController,
      children: _items.map((e) => Text(e)).toList(),
    );
  }
}
```

`initState`에서 초기화하고, `dispose`에서 정리한다. 이 둘을 짝으로 기억하면 된다. 컨트롤러를 `initState`에서 만들었으면 반드시 `dispose`에서 해제해야 한다. 안 그러면 메모리 누수가 생긴다.

---

## setState 안에 무엇을 넣고 무엇을 빼야 하나

원칙은 간단하다. **동기적인 상태 변경만 넣는다.**

```dart
// 좋은 예 — 값 변경만 넣음
setState(() {
  count++;
  isExpanded = !isExpanded;
});

// 나쁜 예 — 비동기 작업을 넣음
setState(() async {        // async setState는 하지 마라!
  final data = await api.fetch();
  items = data;
});
```

왜 비동기를 넣으면 안 되냐면 — `setState`의 콜백은 즉시 실행되고 끝나야 한다. `async`를 넣으면 `fn()`이 Future를 리턴하는데, `setState`는 그 Future를 기다리지 않는다. `fn()`이 리턴되자마자 바로 `markNeedsBuild()`를 호출해버림. 아직 `await` 뒤의 코드가 실행 안 됐는데 이미 빌드가 시작되는 거다.

```dart
// 이렇게 해야 한다
Future<void> _loadData() async {
  final data = await api.fetch();  // 기다린 다음에
  if (!mounted) return;            // 위젯이 아직 살아있는지 확인
  setState(() {
    items = data;                  // 동기적으로 값만 바꿈
  });
}
```

비동기 작업은 밖에서 하고, 결과가 오면 `setState`로 동기적으로 반영하는 거다. `mounted` 체크도 중요한데, 이건 뒤에서 따로 다룬다.

---

## 어디까지 다시 그려지나 — 리빌드 범위

`setState`를 호출한 위젯의 `build()`가 다시 실행된다. 여기서 "그 위젯의 build"가 핵심이다. 전체 앱이 아니라 그 위젯부터 아래쪽.

```
        MaterialApp
            │
         Scaffold      ← 여기는 리빌드 안 됨
        ┌───┴───┐
     AppBar    Body    ← 여기도 안 됨
                │
         CounterPage   ← setState 호출 → build() 다시 실행
          ┌────┴────┐
        Text      Button  ← 자식도 다시 만들어짐
```

"자식도 다시 만들어짐"이라고 했는데, Flutter가 자식을 항상 새로 그린다는 뜻은 아니다. 위젯은 새 인스턴스가 만들어지지만, Flutter는 기존 Element와 비교해서 같으면 재사용한다. `const` 위젯이면 아예 새 인스턴스도 안 만듦.

```dart
@override
Widget build(BuildContext context) {
  return Column(
    children: [
      const Text('제목'),       // const라서 재생성 안 됨
      Text('카운트: $count'),    // count가 바뀌면 새로 만들어짐
      const SizedBox(height: 8), // const라서 재생성 안 됨
      HeavyWidget(data: data),   // data가 안 바뀌어도 일단 새로 만들어짐
    ],
  );
}
```

이게 성능 팁의 시작점이다. 변하지 않는 위젯에 `const`를 붙이면 리빌드 비용이 줄어든다.

---

## 리빌드 비용을 줄이는 실전 기법

### setState의 범위를 좁혀라

```dart
// 나쁜 예 — 전체 페이지가 리빌드
class _ProductPageState extends State<ProductPage> {
  bool isFavorite = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        ProductImage(url: widget.imageUrl),  // 이미지도 다시 빌드됨
        ProductInfo(name: widget.name),       // 정보도 다시 빌드됨
        IconButton(                           // 하트만 바꾸면 되는데
          icon: Icon(isFavorite ? Icons.favorite : Icons.favorite_border),
          onPressed: () => setState(() => isFavorite = !isFavorite),
        ),
      ],
    );
  }
}
```

하트 버튼 하나 누를 때마다 이미지, 정보 위젯까지 전부 리빌드된다. 이걸 분리하면:

```dart
// 좋은 예 — 하트 부분만 따로 뺌
class _ProductPageState extends State<ProductPage> {
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        ProductImage(url: widget.imageUrl),
        ProductInfo(name: widget.name),
        FavoriteButton(),  // 이 안에서만 setState
      ],
    );
  }
}

class FavoriteButton extends StatefulWidget {
  @override
  State<FavoriteButton> createState() => _FavoriteButtonState();
}

class _FavoriteButtonState extends State<FavoriteButton> {
  bool isFavorite = false;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(isFavorite ? Icons.favorite : Icons.favorite_border),
      onPressed: () => setState(() => isFavorite = !isFavorite),
    );
  }
}
```

이제 하트를 누르면 `FavoriteButton`만 리빌드된다. 이미지랑 정보는 건드리지 않음. 이게 "setState의 범위를 좁히는 것"이다.

### const로 리빌드를 막아라

```dart
@override
Widget build(BuildContext context) {
  return Column(
    children: [
      const Header(),               // 매번 리빌드 안 됨
      Text('$count'),               // 얘만 바뀜
      const SizedBox(height: 16),   // 매번 리빌드 안 됨
      const Footer(),               // 매번 리빌드 안 됨
    ],
  );
}
```

`const`는 컴파일 시점에 인스턴스가 하나만 만들어진다. 부모가 리빌드돼도 같은 인스턴스를 재사용하니까 비교 자체가 필요 없다.

---

## mounted 체크 — 죽은 위젯에 말 걸지 마라

비동기 작업 후에 `setState`를 호출하면, 그 사이에 위젯이 이미 dispose됐을 수 있다. 사용자가 페이지를 떠났는데 API 응답이 뒤늦게 와서 `setState`를 호출하면 에러가 난다.

```dart
Future<void> _loadProfile() async {
  final profile = await api.getProfile();

  // 이 시점에 사용자가 이미 뒤로가기를 눌렀다면?
  // State가 dispose된 상태 → setState 호출하면 에러

  if (!mounted) return;  // 살아있는지 먼저 확인

  setState(() {
    _profile = profile;
  });
}
```

```
사용자가 프로필 페이지 진입
     │
     ├─ _loadProfile() 호출 → API 요청 시작
     │
     ├─ 사용자가 뒤로가기 누름 → dispose() 호출됨
     │
     └─ API 응답이 도착 → setState() 호출하려는데...
          │
          ├─ mounted == false → return (안전)
          └─ mounted 안 체크 → 💥 에러!
```

`mounted`는 State 객체가 아직 위젯 트리에 살아있는지 알려주는 boolean이다. `dispose()` 이후에는 `false`가 된다. 비동기 작업 후에는 항상 체크하는 습관을 들이자.

---

## setState를 쓰면 안 되는 곳들

### build() 안에서

```dart
@override
Widget build(BuildContext context) {
  setState(() { count++; });  // 절대 하지 마라
  return Text('$count');
}
```

`build()` 안에서 `setState()`를 부르면 무한 루프다. `setState` → `build` → `setState` → `build` → ... 프레임워크가 이걸 감지하고 에러를 뱉는다.

### initState() 안에서

```dart
@override
void initState() {
  super.initState();
  setState(() { isReady = true; });  // 의미 없다
}
```

`initState()`는 첫 번째 `build()` 전에 호출된다. 여기서 `setState()`를 부르는 건 "아직 안 그렸는데 다시 그려"라는 의미 없는 요청이다. 그냥 변수를 직접 바꾸면 된다.

```dart
@override
void initState() {
  super.initState();
  isReady = true;  // 이렇게만 하면 됨. 첫 build에서 반영된다
}
```

### dispose() 이후

```dart
@override
void dispose() {
  _timer?.cancel();
  super.dispose();
}

void _onTimerTick() {
  setState(() { elapsed++; });  // dispose 후에 호출되면 에러
}
```

dispose된 후에 타이머 콜백이 실행될 수 있다. 타이머를 `dispose()`에서 취소하는 건 기본 중의 기본이다.

---

## 리스트와 객체 — 참조가 같으면 안 바뀐다

가끔 `setState`를 했는데 화면이 안 바뀌는 경우가 있다. 특히 리스트나 객체를 다룰 때.

```dart
List<String> items = ['사과', '바나나'];

// 이렇게 하면 안 바뀔 수도 있다
setState(() {
  items.add('딸기');  // 같은 리스트에 추가
});
```

동작하긴 한다. `setState`가 `markNeedsBuild`를 부르니까 `build()`는 다시 실행된다. 근데 만약 하위 위젯이 `items`를 받아서 `==` 비교를 하면, 같은 리스트 인스턴스니까 "안 바뀜"으로 판단할 수 있다.

```dart
// 안전한 방법 — 새 리스트를 만들어라
setState(() {
  items = [...items, '딸기'];  // 새 인스턴스
});
```

스프레드 연산자로 새 리스트를 만들면 참조가 달라지니까 모든 비교에서 "바뀜"으로 판단한다. 객체도 마찬가지다:

```dart
// 위험 — 같은 객체를 수정
setState(() {
  user.name = '새이름';
});

// 안전 — 새 객체를 만듦
setState(() {
  user = user.copyWith(name: '새이름');
});
```

`copyWith` 패턴은 Flutter에서 불변 상태를 다룰 때 기본기다. Dart의 `freezed` 패키지를 쓰면 `copyWith`를 자동으로 만들어준다.

---

## 여러 개의 상태를 한 번에 바꿀 때

```dart
// setState를 여러 번? 아니면 한 번에?

// 나쁜 건 아닌데 비효율
setState(() { name = '홍길동'; });
setState(() { age = 25; });
setState(() { isVerified = true; });

// 이렇게 한 번에 모으는 게 낫다
setState(() {
  name = '홍길동';
  age = 25;
  isVerified = true;
});
```

앞서 말했듯이 `setState`를 여러 번 호출해도 `build()`는 한 번만 실행된다. 그래서 결과는 같다. 하지만 한 번에 모으는 게 의도가 명확하고 읽기도 편하다. "이 세 가지가 함께 바뀌는 거구나"가 한눈에 보이니까.

---

## setState vs 상태관리 라이브러리 — 언제 뭘 쓸까

setState로 충분한 경우:

```
┌──────────────────────────────────────────────────┐
│  setState가 잘 맞는 상황                            │
├──────────────────────────────────────────────────┤
│  - 상태가 한 위젯 안에서만 쓰임                       │
│  - 단순한 UI 토글 (펼치기/접기, 탭 전환)              │
│  - 폼 입력의 로컬 유효성 검사                        │
│  - 애니메이션 관련 플래그                            │
│  - 현재 선택된 인덱스                               │
└──────────────────────────────────────────────────┘
```

[[Flutter Provider|상태관리 라이브러리]]가 필요한 경우:

```
┌──────────────────────────────────────────────────┐
│  상태관리 라이브러리가 필요한 상황                      │
├──────────────────────────────────────────────────┤
│  - 여러 위젯이 같은 상태를 공유                       │
│  - 서버 데이터를 캐싱하고 여러 화면에서 사용             │
│  - 인증 같은 앱 전역 상태                            │
│  - 복잡한 비즈니스 로직이 UI와 분리되어야 할 때          │
│  - 상태 변경에 따른 부수효과(네비게이션 등) 처리          │
└──────────────────────────────────────────────────┘
```

현실적인 판단 기준은 이거다: **그 상태를 다른 위젯이 알아야 하나?** 아니면 setState. 알아야 하면 끌어올리거나 상태관리 라이브러리를 쓴다.

```
"이 체크박스의 체크 여부" → setState
"장바구니에 담긴 상품 목록" → 상태관리 라이브러리
"텍스트필드에 글자가 있는지 없는지" → setState
"로그인 했는지 안 했는지" → 상태관리 라이브러리
"드롭다운이 열려있는지" → setState
"선택된 필터 조건으로 걸러진 목록" → 상태관리 라이브러리
```

---

## ValueNotifier — setState 없이 부분 갱신

모든 로컬 상태에 StatefulWidget을 만들기 번거롭다면, `ValueNotifier` + `ValueListenableBuilder`를 쓰는 방법도 있다.

```dart
class MyPage extends StatelessWidget {
  final ValueNotifier<int> _counter = ValueNotifier(0);

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const Text('이 텍스트는 리빌드 안 됨'),
        ValueListenableBuilder<int>(
          valueListenable: _counter,
          builder: (context, count, child) {
            return Text('$count');  // 여기만 리빌드
          },
        ),
        ElevatedButton(
          onPressed: () => _counter.value++,
          child: const Text('증가'),
        ),
      ],
    );
  }
}
```

StatefulWidget 없이도 부분 갱신이 된다. `ValueNotifier`는 값이 바뀌면 `ValueListenableBuilder`만 다시 그린다. 나머지 위젯은 건드리지 않음.

다만 주의할 점 — StatelessWidget에서 `ValueNotifier`를 필드로 가지면 위젯이 리빌드될 때마다 새 인스턴스가 만들어진다. 이전 값이 날아감. 부모가 자주 리빌드되는 구조라면 StatefulWidget의 State에 넣어야 안전하다.

---

## 실전 예제 모음

### 토글 버튼

```dart
class _ToggleState extends State<ToggleButton> {
  bool isOn = false;

  @override
  Widget build(BuildContext context) {
    return Switch(
      value: isOn,
      onChanged: (value) => setState(() => isOn = value),
    );
  }
}
```

### 비동기 로딩 패턴

```dart
class _UserListState extends State<UserListPage> {
  List<User> users = [];
  bool isLoading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  Future<void> _loadUsers() async {
    try {
      final result = await api.getUsers();
      if (!mounted) return;
      setState(() {
        users = result;
        isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        error = e.toString();
        isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (isLoading) return const Center(child: CircularProgressIndicator());
    if (error != null) return Center(child: Text('에러: $error'));
    return ListView.builder(
      itemCount: users.length,
      itemBuilder: (_, i) => ListTile(title: Text(users[i].name)),
    );
  }
}
```

`isLoading`, `error`, `users` 세 가지 상태로 로딩/에러/성공을 관리하는 기본 패턴이다. 간단한 화면에서는 이것만으로 충분하다.

### 폼 유효성 검사

```dart
class _LoginFormState extends State<LoginForm> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  String? _emailError;
  String? _passwordError;

  void _validate() {
    setState(() {
      _emailError = _emailController.text.contains('@')
          ? null
          : '올바른 이메일을 입력하세요';
      _passwordError = _passwordController.text.length >= 8
          ? null
          : '8자 이상 입력하세요';
    });
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TextField(
          controller: _emailController,
          decoration: InputDecoration(errorText: _emailError),
        ),
        TextField(
          controller: _passwordController,
          obscureText: true,
          decoration: InputDecoration(errorText: _passwordError),
        ),
        ElevatedButton(
          onPressed: _validate,
          child: const Text('로그인'),
        ),
      ],
    );
  }
}
```

### 아코디언 (펼치기/접기)

```dart
class _FaqItemState extends State<FaqItem> {
  bool isExpanded = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        GestureDetector(
          onTap: () => setState(() => isExpanded = !isExpanded),
          child: Row(
            children: [
              Expanded(child: Text(widget.question)),
              Icon(isExpanded ? Icons.expand_less : Icons.expand_more),
            ],
          ),
        ),
        if (isExpanded)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(widget.answer),
          ),
      ],
    );
  }
}
```

`if (isExpanded)` — Dart에서 컬렉션 안에 조건문을 쓸 수 있다. `isExpanded`가 true일 때만 답변 위젯이 트리에 들어감.

---

## 삽질에서 건진 것들

`setState(() async { ... })`를 쓰고 "왜 데이터가 안 보이지?" 한 적이 있다. `setState`의 콜백은 동기여야 한다. 비동기 작업은 밖에서 하고, 결과만 `setState`로 반영하자.

`initState`에서 `setState`를 호출했는데 동작은 했지만 의미가 없었다. 아직 첫 `build` 전이니까 그냥 변수에 직접 대입하면 된다. 불필요한 리빌드 예약이다.

리스트에 `add`하고 `setState`했는데 하위 위젯이 변경을 감지 못한 적이 있다. 같은 리스트 인스턴스라 `==` 비교에서 같다고 나온 거다. 스프레드 연산자(`[...list, newItem]`)로 새 리스트를 만들었더니 해결됐다.

페이지 나가고 나서 API 응답이 와서 `setState called after dispose` 에러가 터졌다. 그 뒤로 비동기 작업 후에는 무조건 `if (!mounted) return`을 넣는다.

상태가 5~6개로 늘어나면서 `setState`만으로 관리하기가 점점 고통스러워졌다. 에러 상태, 로딩 상태, 데이터, 필터, 정렬... 변수가 늘어날수록 서로 맞물리는 조합이 많아진다. 이때가 상태관리 라이브러리를 도입하기 좋은 타이밍이다. setState에서 시작해서, 복잡해지면 올려보내는 거지, 처음부터 거창하게 갈 필요는 없다.
