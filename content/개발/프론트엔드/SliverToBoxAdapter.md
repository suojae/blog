---
title: "SliverToBoxAdapter"
tags:
  - flutter
  - sliver
  - CustomScrollView
  - scroll
  - rendering-pipeline
  - layout
---

## 스크롤 화면을 만드는 두 가지 방법

Flutter에서 스크롤 가능한 화면을 만드는 방법은 크게 두 가지다.

하나는 `ListView`처럼 간단하게 쓰는 방식. 위젯을 쭉 나열하면 알아서 스크롤된다. 근데 이건 "전부 리스트"일 때만 편하다. 현실의 화면은 그렇지 않다. 상단에 배너가 있고, 중간에 그리드가 있고, 그 밑에 또 리스트가 있고, 끝에 안내 문구가 붙는다.

```
실제 앱 화면 구조:
┌─────────────────────┐
│    접히는 앱바         │ ← SliverAppBar
├─────────────────────┤
│  "오늘의 추천"  텍스트   │ ← 그냥 Text 위젯
├─────────────────────┤
│ 🟦 🟦 🟦             │
│ 🟦 🟦 🟦             │ ← SliverGrid
│ 🟦 🟦 🟦             │
├─────────────────────┤
│  "전체 상품" 텍스트     │ ← 그냥 Text 위젯
├─────────────────────┤
│  상품 1               │
│  상품 2               │ ← SliverList
│  상품 3               │
│  ...                 │
└─────────────────────┘
```

이런 화면을 `ListView` 하나로 만들려면 복잡하다. 리스트 안에 그리드를 넣으면 높이 계산이 꼬이고, `shrinkWrap: true`로 억지로 맞추면 성능이 나빠진다.

다른 하나가 `CustomScrollView` + **Sliver** 조합이다. 각 영역을 Sliver라는 단위로 쪼개서 조립한다. 앱바, 그리드, 리스트, 여백을 전부 하나의 스크롤 안에서 자유롭게 배치할 수 있다.

---

## Sliver는 뭔가

Sliver(슬리버)는 "스크롤 가능한 영역의 한 조각"이다. 얇게 썬 조각이라는 뜻 그대로, 스크롤 가능한 화면을 얇은 조각들로 나눠서 조립하는 방식이다.

일반 위젯(`Container`, `Text`, `Card` 등)은 "나는 가로 이만큼, 세로 이만큼이야"라고 자기 크기를 정한다. 이걸 **Box 프로토콜**이라고 부른다.

Sliver는 다르다. "스크롤이 지금 여기까지 왔으니까, 나는 이만큼만 보여줄게"라고 스크롤 위치에 반응해서 자기 크기를 정한다. 이게 **Sliver 프로토콜**이다.

```
Box 위젯:                          Sliver 위젯:
"내 크기는 200x100이야"             "스크롤이 50px 지나갔으니
 항상 같은 크기                      나는 150px만 보여줄게"

┌──────────────┐                 ┌──────────────┐
│              │                 │   보이는 부분   │ ← 150px
│   200x100    │                 │              │
│   항상 이 크기 │                 └──────────────┘
│              │                   가려진 부분     ← 50px
└──────────────┘                   (스크롤로 지나감)
```

이 차이 때문에 Sliver는 화면 밖으로 나간 항목을 그리지 않는다. 리스트에 1000개 항목이 있어도 화면에 보이는 10개만 렌더링함. 이게 `ListView.builder`가 빠른 이유이기도 하다 — 내부적으로 Sliver를 쓰고 있거든.

---

## 문제: Box 위젯은 Sliver 세계에 못 들어간다

`CustomScrollView`의 `slivers` 배열에는 Sliver 위젯만 넣을 수 있다.

```dart
CustomScrollView(
  slivers: [
    SliverAppBar(title: Text('제목')),  // ✅ Sliver 위젯
    SliverList(...),                    // ✅ Sliver 위젯
    Container(child: Text('안내문구')),   // ❌ Box 위젯 → 에러!
  ],
)
```

Box 위젯을 여기에 넣으면 타입 에러가 난다. `Container`는 `Widget`이지 `Sliver`가 아니니까.

비유하면 이렇다. 고속도로(CustomScrollView)에는 자동차(Sliver)만 진입할 수 있다. 자전거(Box 위젯)가 직접 올라가면 안 된다. 자전거를 차에 실어야 한다.

---

## SliverToBoxAdapter가 그 차다

`SliverToBoxAdapter`는 **Box 위젯을 Sliver로 감싸주는 어댑터**다.

```dart
CustomScrollView(
  slivers: [
    SliverAppBar(title: Text('제목')),

    // Box 위젯을 Sliver로 변환
    SliverToBoxAdapter(
      child: Container(
        padding: EdgeInsets.all(16),
        child: Text('안내문구'),  // 이제 에러 안 남
      ),
    ),

    SliverList(...),
  ],
)
```

`SliverToBoxAdapter`는 Sliver 프로토콜을 따르는 위젯이고, 그 안에 Box 프로토콜의 `child`를 하나 받는다. 스크롤 시스템한테는 "나 Sliver야"라고 말하고, 안에서는 일반 위젯을 품고 있는 거다.

```
CustomScrollView가 보는 시점:
┌─────────────────────────────────┐
│  SliverAppBar      → Sliver ✅  │
│  SliverToBoxAdapter → Sliver ✅  │  ← 겉은 Sliver
│    └─ Container                 │  ← 속은 Box
│  SliverList        → Sliver ✅  │
└─────────────────────────────────┘
```

---

## 실전에서 언제 쓰나

### 1. 리스트 위에 헤더를 넣을 때

```dart
CustomScrollView(
  slivers: [
    SliverAppBar(
      expandedHeight: 200,
      flexibleSpace: FlexibleSpaceBar(title: Text('맛집 지도')),
    ),

    // 카테고리 필터 칩들
    SliverToBoxAdapter(
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Wrap(
          spacing: 8,
          children: ['한식', '중식', '일식', '양식']
              .map((e) => FilterChip(label: Text(e), onSelected: (_) {}))
              .toList(),
        ),
      ),
    ),

    // 맛집 리스트
    SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) => ListTile(title: Text('맛집 ${index + 1}')),
        childCount: 30,
      ),
    ),
  ],
)
```

필터 칩은 고정 크기의 일반 위젯이다. 리스트처럼 반복되는 게 아니라 한 번만 나오는 영역. 이런 게 `SliverToBoxAdapter`에 딱 맞다.

### 2. 리스트 사이에 배너를 끼울 때

```dart
CustomScrollView(
  slivers: [
    SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) => ProductCard(product: topProducts[index]),
        childCount: topProducts.length,
      ),
    ),

    // 중간 배너
    SliverToBoxAdapter(
      child: Container(
        height: 120,
        margin: EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: Colors.blue.shade50,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Center(child: Text('지금 가입하면 20% 할인!')),
      ),
    ),

    SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) => ProductCard(product: moreProducts[index]),
        childCount: moreProducts.length,
      ),
    ),
  ],
)
```

### 3. 리스트 아래에 "끝" 표시를 넣을 때

```dart
CustomScrollView(
  slivers: [
    SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) => PostTile(post: posts[index]),
        childCount: posts.length,
      ),
    ),

    SliverToBoxAdapter(
      child: Padding(
        padding: EdgeInsets.all(32),
        child: Center(
          child: Text('모든 게시글을 확인했습니다', style: TextStyle(color: Colors.grey)),
        ),
      ),
    ),
  ],
)
```

### 4. 서로 다른 레이아웃을 한 스크롤에 합칠 때

이게 `CustomScrollView`의 진짜 힘이다. 그리드와 리스트를 하나의 스크롤로 묶고, 중간중간 일반 위젯을 끼워넣는다.

```dart
CustomScrollView(
  slivers: [
    SliverAppBar(title: Text('쇼핑몰')),

    SliverToBoxAdapter(
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Text('인기 상품', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
      ),
    ),

    SliverGrid(
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2),
      delegate: SliverChildBuilderDelegate(
        (context, index) => ProductCard(product: popular[index]),
        childCount: popular.length,
      ),
    ),

    SliverToBoxAdapter(
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Text('최근 본 상품', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
      ),
    ),

    SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) => ListTile(title: Text(recent[index].name)),
        childCount: recent.length,
      ),
    ),
  ],
)
```

---

## SliverToBoxAdapter vs 다른 Sliver 위젯들

어떤 상황에서 뭘 써야 하는지 정리하면:

```
넣고 싶은 게 뭐야?
│
├─ 리스트 (같은 형태가 반복) → SliverList
├─ 그리드 (같은 형태가 격자로) → SliverGrid
├─ 접히는 앱바             → SliverAppBar
├─ 빈 여백               → SliverPadding, SliverToBoxAdapter(child: SizedBox)
│
└─ 그 외 일반 위젯 한 개    → SliverToBoxAdapter ← 여기
   (배너, 헤더 텍스트, 안내문구, 버튼, 커스텀 위젯 등)
```

핵심은 **"한 개짜리 고정 위젯"에 SliverToBoxAdapter를 쓴다**는 거다. 반복되는 항목에는 `SliverList`나 `SliverGrid`를 써야 한다. 이유는 성능이다.

```dart
// ❌ 나쁜 예 — 항목마다 SliverToBoxAdapter를 만듦
CustomScrollView(
  slivers: [
    for (final item in items)
      SliverToBoxAdapter(child: ListTile(title: Text(item.name))),
  ],
)

// ✅ 좋은 예 — SliverList가 알아서 lazy 렌더링
CustomScrollView(
  slivers: [
    SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) => ListTile(title: Text(items[index].name)),
        childCount: items.length,
      ),
    ),
  ],
)
```

`SliverList`는 화면에 보이는 항목만 빌드한다. `SliverToBoxAdapter`를 100개 만들면 100개 전부 빌드됨. 항목이 많을수록 성능 차이가 커진다.

---

## 자주 같이 쓰는 Sliver 위젯 모음

`SliverToBoxAdapter`를 쓴다는 건 `CustomScrollView`를 쓴다는 뜻이고, 그럼 다른 Sliver 위젯들도 자연스럽게 만나게 된다.

```dart
CustomScrollView(
  slivers: [
    // 접히는 앱바
    SliverAppBar(
      expandedHeight: 200,
      pinned: true,
      flexibleSpace: FlexibleSpaceBar(title: Text('프로필')),
    ),

    // 고정 크기 위젯 → SliverToBoxAdapter
    SliverToBoxAdapter(child: ProfileHeader()),

    // 여백 → SliverPadding으로 Sliver 자체에 패딩
    SliverPadding(
      padding: EdgeInsets.all(16),
      sliver: SliverGrid(
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3),
        delegate: SliverChildBuilderDelegate(
          (context, index) => PhotoThumbnail(photo: photos[index]),
          childCount: photos.length,
        ),
      ),
    ),

    // 리스트 → SliverList
    SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) => ActivityTile(activity: activities[index]),
        childCount: activities.length,
      ),
    ),

    // 빈 공간 채우기 → SliverFillRemaining
    SliverFillRemaining(
      hasScrollBody: false,
      child: Center(child: Text('더 이상 활동이 없습니다')),
    ),
  ],
)
```

`SliverFillRemaining`은 남은 공간을 채우는 Sliver다. 항목이 적어서 화면이 비어 보일 때 유용하다.

---

## NestedScrollView와의 관계

탭바가 있고, 각 탭마다 스크롤 가능한 리스트가 있는 화면을 생각해보자. 이때는 `NestedScrollView`를 쓰는데, 여기서도 `SliverToBoxAdapter`가 등장한다.

```dart
NestedScrollView(
  headerSliverBuilder: (context, innerBoxIsScrolled) {
    return [
      SliverAppBar(
        expandedHeight: 200,
        pinned: true,
        flexibleSpace: FlexibleSpaceBar(title: Text('마이페이지')),
      ),

      // 프로필 정보 — 일반 위젯이니까 SliverToBoxAdapter
      SliverToBoxAdapter(child: ProfileSummaryCard()),

      // 탭바
      SliverPersistentHeader(
        pinned: true,
        delegate: TabBarDelegate(tabBar: TabBar(tabs: [...])),
      ),
    ];
  },
  body: TabBarView(
    children: [PostsTab(), LikesTab(), BookmarksTab()],
  ),
)
```

`headerSliverBuilder`가 리턴하는 건 Sliver 리스트다. 여기에 일반 위젯을 넣으려면 `SliverToBoxAdapter`가 필요하다.

---

## 삽질에서 건진 것들

`SliverToBoxAdapter` 안에 `ListView`를 넣었더니 에러가 났다. 스크롤 가능한 위젯 안에 또 스크롤 가능한 위젯을 넣으면 충돌한다. 굳이 넣어야 한다면 `ListView`에 `shrinkWrap: true`와 `NeverScrollableScrollPhysics()`를 줘야 하는데, 그보단 애초에 `SliverList`로 바꾸는 게 맞다.

항목이 20개 정도인 리스트를 `SliverToBoxAdapter` + `Column`으로 만든 적이 있다. "어차피 적으니까 괜찮겠지"했는데, 화면 진입 시 20개를 한꺼번에 빌드하니까 눈에 띄게 느렸다. `SliverList.builder`로 바꾸니까 바로 해결됐다. 개수가 10개 넘어가면 `SliverList`를 쓰자.

`SliverToBoxAdapter`에 높이가 무한한 위젯을 넣으면 에러가 난다. `SliverToBoxAdapter`는 child의 크기를 측정해서 그만큼의 Sliver 공간을 차지하는데, 높이가 무한이면 측정 자체가 불가능하다. `Expanded`, 제한 없는 `Column` 안의 `ListView` 같은 걸 넣지 않도록 주의.

[[setState]]에서 리빌드 범위를 좁히는 게 중요하다고 했는데, Sliver 세계에서도 마찬가지다. `SliverToBoxAdapter` 안에 무거운 위젯을 넣어야 한다면, 그 위젯을 별도 StatefulWidget으로 분리해서 리빌드 범위를 제한하는 게 좋다.
