---
title: "shrinkWrap: true가 리스트를 느리게 만드는 이유"
tags:
  - flutter
  - shrinkWrap
  - ListView
  - scroll
  - layout
  - rendering-pipeline
  - performance
---

## 리스트는 원래 게으르다

Flutter의 `ListView.builder`가 빠른 이유는 하나다. 게으르니까. 화면에 보이는 항목만 만들고, 나머지는 존재하지 않는 것처럼 무시한다.

```
1000개 항목이 있는 리스트:

화면 밖 (위) ─ 이미 지나간 항목 → 메모리에서 제거됨
┌─────────────────────┐
│  항목 7              │
│  항목 8              │ ← 화면에 보이는 것만 빌드
│  항목 9              │
│  항목 10             │
└─────────────────────┘
화면 밖 (아래) ─ 아직 안 본 항목 → 아예 만들지도 않음
```

이게 가능한 건 `ListView`가 내부적으로 [[SliverToBoxAdapter|Sliver 프로토콜]]을 쓰기 때문이다. Sliver는 "지금 스크롤 위치가 여기니까, 이 범위의 항목만 보여주면 돼"라는 정보를 받는다. 그래서 전체 리스트 크기를 몰라도 된다. 현재 뷰포트 근처만 알면 충분하다.

이 덕분에 항목이 100개든 10만 개든 메모리 사용량과 빌드 시간이 거의 같다. 화면에 보이는 건 어차피 10개 내외니까.

---

## shrinkWrap: true가 뒤집는 것

`shrinkWrap: true`를 붙이면 이 게으른 전략이 통째로 무너진다.

왜? `shrinkWrap`의 뜻은 "내 콘텐츠 크기에 맞춰서 줄어들어"다. 리스트가 자기 높이를 정하려면, 안에 뭐가 얼마나 들어있는지 전부 알아야 한다. 그래서 **모든 자식을 한 번에 빌드하고 레이아웃**한다.

```
shrinkWrap: false (기본값)              shrinkWrap: true
─────────────────────                 ─────────────────────
"내 높이? 부모가 정해준                  "내 높이? 내가 계산해야 해.
 만큼 쓸게. 자식은 보이는                  자식이 얼마나 있는지
 것만 만들면 돼."                        전부 알아야 하잖아."

 ┌──────────┐                         ┌──────────┐
 │ 항목 1    │ ← 빌드                   │ 항목 1    │ ← 빌드
 │ 항목 2    │ ← 빌드                   │ 항목 2    │ ← 빌드
 │ 항목 3    │ ← 빌드                   │ 항목 3    │ ← 빌드
 └──────────┘                         │ 항목 4    │ ← 빌드
   항목 4~1000                         │ 항목 5    │ ← 빌드
   → 안 만듦                            │ ...      │
                                      │ 항목 999  │ ← 빌드
                                      │ 항목 1000 │ ← 빌드
                                      └──────────┘
                                      전부 빌드 & 레이아웃!
```

항목이 1000개면 1000개 전부 빌드한다. 화면에 보이든 말든.

---

## 레이아웃 과정에서 무슨 일이 벌어지나

Flutter가 화면을 그리는 과정을 떠올려 보자. [[setState]]에서 다뤘던 렌더링 파이프라인이다.

```
Build → Layout → Paint → Compositing
```

`shrinkWrap: true`가 문제를 일으키는 건 **Build**와 **Layout** 두 단계 모두에서다.

### Build 단계

```dart
// shrinkWrap: false — builder가 화면 범위만 호출됨
ListView.builder(
  itemCount: 1000,
  itemBuilder: (context, index) {
    return ExpensiveWidget(data: items[index]);
  },
)
```

기본 `ListView.builder`에서 `itemBuilder`는 뷰포트 근처의 항목만 호출된다. 화면에 10개가 보이면, 약간의 여유분 포함해서 15개 정도만 빌드한다.

```dart
// shrinkWrap: true — builder가 1000번 호출됨
ListView.builder(
  shrinkWrap: true,
  itemCount: 1000,
  itemBuilder: (context, index) {
    return ExpensiveWidget(data: items[index]);
  },
)
```

`shrinkWrap: true`면? 1000번 호출된다. `ExpensiveWidget`이 네트워크 이미지를 포함하거나, 복잡한 레이아웃을 가지고 있으면 프레임 드랍이 눈에 보인다.

### Layout 단계

빌드가 끝나면 각 위젯의 크기를 계산해야 한다. 1000개 항목의 높이를 전부 측정해서 합산한다. 이 과정이 동기적으로, 한 프레임 안에 일어난다.

```
프레임 시작 (16ms 안에 끝나야 60fps)
  │
  ├─ 항목 1 빌드 + 레이아웃  (0.1ms)
  ├─ 항목 2 빌드 + 레이아웃  (0.1ms)
  ├─ 항목 3 빌드 + 레이아웃  (0.1ms)
  │  ...
  ├─ 항목 1000 빌드 + 레이아웃  (0.1ms)
  │
  └─ 합계: 100ms → 16ms 초과 → 프레임 드랍!
프레임 끝
```

항목 하나당 0.1ms만 잡아도 1000개면 100ms다. 60fps를 유지하려면 한 프레임이 16ms 안에 끝나야 하는데, 이미 6배를 초과했다. 화면이 뚝뚝 끊긴다.

---

## 메모리도 같이 터진다

성능 문제가 CPU만은 아니다. 메모리도 함께 올라간다.

일반 `ListView.builder`는 화면에서 벗어난 항목을 메모리에서 정리한다. 새 항목이 화면에 들어오면 빌드하고, 나간 항목은 해제한다. 그래서 스크롤해도 메모리 사용량이 거의 일정하다.

```
일반 ListView.builder의 메모리 사용:

 메모리
  │
  │  ┌────────────────────────────────
  │  │  약 15개분 (일정)
  │  └────────────────────────────────
  └──────────────────────────────────── 스크롤 위치

shrinkWrap: true의 메모리 사용:

 메모리
  │
  │  ┌────────────────────────────────
  │  │  1000개분 (전부 보유)
  │  │
  │  │
  │  │
  │  └────────────────────────────────
  └──────────────────────────────────── 스크롤 위치
```

각 항목이 위젯 + Element + RenderObject 세 벌이다. 항목 하나에 이미지까지 있으면 꽤 무겁다. 1000개를 전부 들고 있으면 저사양 기기에서 OOM(Out of Memory)이 날 수도 있다.

---

## 그래서 언제 shrinkWrap을 쓰게 되나

대부분 이런 상황에서 쓰게 된다. 스크롤 가능한 위젯 안에 또 스크롤 가능한 위젯을 넣을 때.

```dart
// 흔한 실수: SingleChildScrollView 안에 ListView
SingleChildScrollView(
  child: Column(
    children: [
      Header(),
      ListView.builder(           // ❌ 에러! 높이가 무한
        itemCount: items.length,
        itemBuilder: (_, i) => ItemTile(item: items[i]),
      ),
      Footer(),
    ],
  ),
)
```

이러면 에러가 난다. `Column`은 자식한테 "높이 제한 없어, 네 맘대로"라고 말하는데, `ListView`도 "나도 높이 제한 없이 스크롤할 거야"라고 한다. 무한 높이끼리 만나서 충돌.

그래서 `shrinkWrap: true`를 붙인다. "네 콘텐츠 높이만큼만 차지해"라고 알려주는 거다.

```dart
SingleChildScrollView(
  child: Column(
    children: [
      Header(),
      ListView.builder(
        shrinkWrap: true,                         // 높이 계산을 위해 전부 빌드
        physics: NeverScrollableScrollPhysics(),  // 스크롤 충돌 방지
        itemCount: items.length,
        itemBuilder: (_, i) => ItemTile(item: items[i]),
      ),
      Footer(),
    ],
  ),
)
```

동작은 한다. 근데 `items`가 많으면 느리다. 에러를 피하려고 성능을 희생한 거다.

---

## 해결책: CustomScrollView로 바꾼다

진짜 해결은 "스크롤 안에 스크롤"을 없애는 거다. 전부 하나의 스크롤 안에 Sliver로 넣으면 된다.

```dart
// ❌ 느린 방법 — shrinkWrap으로 억지 해결
SingleChildScrollView(
  child: Column(
    children: [
      Header(),
      ListView.builder(
        shrinkWrap: true,
        physics: NeverScrollableScrollPhysics(),
        itemCount: items.length,
        itemBuilder: (_, i) => ItemTile(item: items[i]),
      ),
      Footer(),
    ],
  ),
)

// ✅ 빠른 방법 — CustomScrollView + Sliver
CustomScrollView(
  slivers: [
    SliverToBoxAdapter(child: Header()),
    SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) => ItemTile(item: items[index]),
        childCount: items.length,
      ),
    ),
    SliverToBoxAdapter(child: Footer()),
  ],
)
```

`CustomScrollView`는 하나의 스크롤 컨트롤러가 모든 Sliver를 관리한다. 각 Sliver는 화면에 보이는 부분만 빌드한다. 스크롤 충돌도 없고, lazy 렌더링도 살아있다.

```
shrinkWrap 방식:                    CustomScrollView 방식:
┌──────────────────┐              ┌──────────────────┐
│ SingleChildScroll │              │ CustomScrollView  │
│  ┌──────────────┐│              │  (하나의 스크롤)     │
│  │   Header     ││              │                   │
│  ├──────────────┤│              │  SliverToBoxAdapter│ ← Header
│  │ ListView     ││              │  SliverList        │ ← lazy 렌더링!
│  │ (전부 빌드)   ││              │  SliverToBoxAdapter│ ← Footer
│  ├──────────────┤│              │                   │
│  │   Footer     ││              └──────────────────┘
│  └──────────────┘│
└──────────────────┘
 스크롤 2개 (충돌!)                  스크롤 1개 (깔끔)
```

---

## 그리드도 마찬가지다

`GridView`도 같은 문제가 있다. `shrinkWrap: true` 붙이면 전체 아이템을 한 번에 빌드한다.

```dart
// ❌ 느림
SingleChildScrollView(
  child: Column(
    children: [
      SomeHeader(),
      GridView.builder(
        shrinkWrap: true,
        physics: NeverScrollableScrollPhysics(),
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2),
        itemCount: products.length,
        itemBuilder: (_, i) => ProductCard(product: products[i]),
      ),
    ],
  ),
)

// ✅ 빠름
CustomScrollView(
  slivers: [
    SliverToBoxAdapter(child: SomeHeader()),
    SliverGrid(
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2),
      delegate: SliverChildBuilderDelegate(
        (context, index) => ProductCard(product: products[index]),
        childCount: products.length,
      ),
    ),
  ],
)
```

---

## 항목이 적으면 괜찮지 않나?

5개, 10개 정도면 솔직히 체감 차이가 거의 없다. `shrinkWrap: true`를 써도 된다.

문제는 이게 습관이 된다는 거다. "어차피 적으니까 shrinkWrap 붙이면 되지"로 시작해서, 나중에 항목이 늘어나도 그대로 두는 경우가 많다. 코드 리뷰에서도 잘 안 걸린다.

경험에서 나온 기준:

```
항목 수       shrinkWrap 써도 되나?
─────────────────────────────────────
5개 이하      괜찮다. 차이 못 느낌
10~20개      슬슬 느려질 수 있음. 항목이 가벼우면 괜찮고,
             이미지나 복잡한 위젯이면 CustomScrollView 추천
50개 이상     무조건 CustomScrollView로 가자
동적 증가     처음엔 적어도 나중에 늘어날 수 있으면
             처음부터 CustomScrollView로 구조 잡기
```

---

## 한 화면에 여러 리스트가 있을 때

쇼핑 앱을 생각해보자. 카테고리별 추천, 최근 본 상품, 인기 상품이 한 화면에 쫙 나열된다.

```dart
// ❌ shrinkWrap 지옥
SingleChildScrollView(
  child: Column(
    children: [
      Text('추천 상품'),
      ListView.builder(
        shrinkWrap: true,
        physics: NeverScrollableScrollPhysics(),
        itemCount: recommended.length,    // 20개 전부 빌드
        itemBuilder: (_, i) => ProductCard(product: recommended[i]),
      ),
      Text('최근 본 상품'),
      ListView.builder(
        shrinkWrap: true,
        physics: NeverScrollableScrollPhysics(),
        itemCount: recent.length,          // 15개 전부 빌드
        itemBuilder: (_, i) => ProductCard(product: recent[i]),
      ),
      Text('인기 상품'),
      ListView.builder(
        shrinkWrap: true,
        physics: NeverScrollableScrollPhysics(),
        itemCount: popular.length,         // 30개 전부 빌드
        itemBuilder: (_, i) => ProductCard(product: popular[i]),
      ),
    ],
  ),
)
// 총 65개 항목을 한 번에 빌드!
```

```dart
// ✅ 전부 Sliver로 통합
CustomScrollView(
  slivers: [
    SliverToBoxAdapter(child: Text('추천 상품')),
    SliverList(
      delegate: SliverChildBuilderDelegate(
        (_, i) => ProductCard(product: recommended[i]),
        childCount: recommended.length,
      ),
    ),
    SliverToBoxAdapter(child: Text('최근 본 상품')),
    SliverList(
      delegate: SliverChildBuilderDelegate(
        (_, i) => ProductCard(product: recent[i]),
        childCount: recent.length,
      ),
    ),
    SliverToBoxAdapter(child: Text('인기 상품')),
    SliverList(
      delegate: SliverChildBuilderDelegate(
        (_, i) => ProductCard(product: popular[i]),
        childCount: popular.length,
      ),
    ),
  ],
)
// 화면에 보이는 항목만 빌드!
```

리스트가 여러 개일수록 shrinkWrap의 비용이 곱으로 늘어난다.

---

## 정리

```
shrinkWrap: true를 쓰면 일어나는 일:

1. lazy 렌더링이 꺼진다
   → 전체 자식을 한 번에 빌드

2. 레이아웃 비용이 O(n)이 된다
   → 항목 수에 비례해서 느려짐

3. 메모리를 전부 차지한다
   → 화면 밖 항목도 메모리에 유지

4. 프레임 드랍이 발생한다
   → 16ms 안에 끝나지 않으면 버벅임
```

```
대안 선택 가이드:

스크롤 안에 리스트를 넣고 싶다
  → CustomScrollView + SliverList

리스트 위아래에 위젯을 넣고 싶다
  → CustomScrollView + SliverToBoxAdapter

리스트 + 그리드 조합
  → CustomScrollView + SliverList + SliverGrid

항목이 5개 이하의 고정 리스트
  → shrinkWrap: true 써도 됨 (또는 그냥 Column)
```

---

## 삽질에서 건진 것들

처음에 `SingleChildScrollView` + `Column` + `ListView(shrinkWrap: true)` 조합을 즐겨 썼다. 빠르게 화면 만들기엔 편하다. 근데 데이터가 많아지니까 화면 진입 시 1~2초씩 멈추는 거다. DevTools에서 프레임 시간을 보니까 빌드 단계에서 300ms 넘게 걸리고 있었다. `CustomScrollView`로 바꾸니까 진입 시간이 확 줄었다.

`physics: NeverScrollableScrollPhysics()`를 깜빡하고 안 넣어서 스크롤이 두 개가 따로 논 적도 있다. 안쪽 리스트가 먼저 스크롤되고, 끝에 가서야 바깥이 스크롤되는데 사용자 입장에서 이상하다. `shrinkWrap`을 쓸 거면 `NeverScrollableScrollPhysics()`는 세트로 달아야 한다. 근데 이 둘을 세트로 달아야 하는 시점이면, 이미 `CustomScrollView`로 가야 한다는 신호다.

항목이 5개밖에 안 되는 리스트를 `CustomScrollView`로 만들었다가 동료한테 "이거 그냥 `Column`이면 되는 거 아님?"이라는 소리를 들었다. 맞는 말이다. 항목이 고정이고 적으면 `Column`이 가장 단순하다. 도구에 맞춰서 문제를 만들지 말자.
