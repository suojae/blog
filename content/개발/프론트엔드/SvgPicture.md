---
title: "SVG 파일 하나가 Flutter 화면의 픽셀이 되기까지"
tags:
  - flutter
  - svg
  - rendering-pipeline
  - caching
  - widget
  - isolate
  - canvas
---

## SvgPicture는 사실 아무것도 안 한다

`SvgPicture`는 `StatelessWidget`이다. 상태도 없고 렌더링 로직도 없다. `build()` 메서드 하나가 전부인데, 거기서 하는 일은 모든 파라미터를 다른 패키지의 위젯에 그대로 넘기는 거.

```dart
@override
Widget build(BuildContext context) {
  return createCompatVectorGraphic(
    loader: bytesLoader,
    width: width,
    height: height,
    // ... 나머지 파라미터 전부 전달
  );
}
```

그럼 왜 존재하냐? "어디서 SVG를 가져올지"를 결정하는 인터페이스 계층이기 때문이다. 사용자에게 `.asset()`, `.network()`, `.file()` 같은 편리한 입구를 제공하고, 실제 렌더링은 범용 벡터 그래픽 엔진에 맡김.

```
SvgPicture (인터페이스)              VectorGraphic (엔진)
───────────────────              ─────────────────────
"어디서 가져올지"                  "어떻게 그릴지"

.asset()   ─┐
.network() ─┤                   VectorGraphic
.file()    ─┼── 전부 위임 →       └─ 바이트 로딩
.memory()  ─┤                      └─ 디코딩 + 캐싱
.string()  ─┘                      └─ Canvas 렌더링
```

---

## 여섯 개의 입구가 하나의 파이프라인으로 합류한다

`SvgPicture`에는 생성자가 6개 있다. 기본 생성자 1개와 named 생성자 5개. 차이점은 내부에서 어떤 Loader를 만드느냐 뿐이고, 그 이후의 파이프라인은 전부 동일함.

```
SvgPicture(loader)    → 직접 전달         → 사용자 커스텀 Loader
.asset(name)          → SvgAssetLoader    → Flutter 에셋 번들
.network(url)         → SvgNetworkLoader  → HTTP URL
.file(file)           → SvgFileLoader     → 파일 시스템
.memory(bytes)        → SvgBytesLoader    → 메모리 (Uint8List)
.string(string)       → SvgStringLoader   → SVG XML 문자열
```

모든 named 생성자는 initializer list에서 Loader 객체를 생성한다:

```dart
SvgPicture.asset(String assetName, { ... })
    : bytesLoader = SvgAssetLoader(assetName, ...);
```

기본 생성자만 `const`인 이유 — named 생성자는 initializer list에서 객체를 새로 만들기 때문에 컴파일 타임 상수가 될 수 없다.

---

## Loader는 두 단계로 SVG를 바이너리로 바꾼다

Loader들은 모두 `SvgLoader<T>`를 상속한다. 이 추상 클래스에는 2단계 파이프라인이 있음:

```
loadBytes(context)
  │
  ├─ 캐시 확인 → 히트면 즉시 반환
  │
  └─ 캐시 미스 → _load(context)
       │
       ├─ ① prepareMessage(context)  ← 메인 스레드에서 원본 데이터 확보
       │   예: 에셋 번들에서 바이트 읽기, HTTP GET 요청
       │
       └─ ② compute(() => encodeSvg(...))  ← 별도 Isolate에서 컴파일
            │   SVG XML 문자열 → 바이너리 ByteData
            │
            └─ 캐시에 저장 후 반환
```

왜 2단계로 나눴냐면 — `prepareMessage()`는 `BuildContext`에 접근해야 하니까 메인 스레드에서 실행된다. 무거운 XML 파싱과 바이너리 컴파일은 `compute()`로 별도 Isolate에 보내서 UI를 막지 않음.

각 Loader의 구현이 다른 부분은 `prepareMessage()`뿐이다:

```
SvgAssetLoader  → AssetBundle.load(assetName) → ByteData
SvgNetworkLoader → http.Client.get(url) → Uint8List
SvgFileLoader   → file.readAsBytesSync() → bytes
SvgStringLoader → 아무것도 안 함 (이미 문자열)
```

바이너리로 변환하는 이유는 — XML은 파싱이 느리고, 바이너리는 별도 파싱 없이 바로 읽을 수 있다. 한 번 컴파일해서 캐시하면 두 번째부터는 훨씬 빠름.

---

## 바이너리가 그리기 명령어로 풀리는 과정

Loader가 바이너리를 반환하면, 렌더링 엔진이 이걸 Flutter Canvas 명령어로 변환한다. Listener 패턴을 씀.

코덱이 바이트를 하나씩 읽으면서 리스너의 콜백을 호출한다. 리스너가 실제 Flutter 객체를 만든다:

```
ByteData [0x01, 0x0A, 0x14, ...]
  │
  ▼
코덱 → 리스너: "빨간색 페인트 만들어!"
리스너: Paint(color: red)를 만들어서 _paints[0]에 저장

코덱 → 리스너: "(10,20)으로 이동, (30,40)으로 선!"
리스너: path.moveTo(10, 20); path.lineTo(30, 40);

코덱 → 리스너: "paths[0]을 paints[0]으로 그려!"
리스너: canvas.drawPath(_paths[0], _paints[0])
         → PictureRecorder에 녹화 중
```

모든 그리기 명령이 `PictureRecorder`에 녹화된다. 녹화가 끝나면 `Picture` 객체가 완성됨.

Picture는 Canvas에 그린 모든 명령어를 담고 있는 객체다. 아직 픽셀은 아니다. "빨간 선을 여기서 저기로 그어라" 같은 레시피. 나중에 화면에 "재생"하면 그때 픽셀이 됨.

---

## 두 겹의 캐시가 있다

같은 SVG를 화면 여러 곳에서 쓸 때, 매번 처음부터 로딩하면 느리다. 그래서 2단계 캐시가 있음.

```
1단계: SVG 컴파일 캐시 (LRU, 최대 100개)
  키: Loader + 테마 + ColorMapper
  값: ByteData (컴파일된 바이너리)
  → XML 파싱 + Isolate 컴파일을 건너뜀

2단계: Picture 캐시 (참조 카운팅)
  키: Loader + locale + textDirection
  값: PictureInfo + 사용 중 위젯 수
  → 바이트 디코딩을 건너뜀
```

왜 캐시가 두 겹이냐면 — 관리 주체가 다르다. 1단계는 SVG 파싱 패키지가, 2단계는 렌더링 엔진이 각자 관리함. 캐시 키도 다르다. 같은 SVG라도 테마가 바뀌면 1단계 캐시가 미스나고, locale이 바뀌면 2단계 캐시가 미스남.

1단계 LRU 캐시는 최대 100개를 저장한다. 가득 차면 가장 오래 안 쓴 항목을 버림.

2단계는 참조 카운팅으로 작동한다. 같은 아이콘이 화면에 3개 있으면, Picture를 3번 디코딩하지 않고 1개를 공유함. 각 위젯이 마운트될 때 count +1, 디스포즈될 때 count -1. count가 0이 되면 캐시에서 삭제하고 GPU 메모리를 해제한다.

```
Icon A ──┐
Icon B ──┼──► PictureData { pictureInfo, count: 3 }
Icon C ──┘

Icon A 사라짐 → count: 2
Icon B 사라짐 → count: 1
Icon C 사라짐 → count: 0 → 캐시 삭제 + picture.dispose()
```

캐시가 작동하면:

```
처음 사용:
  .asset('icon.svg')
  → 번들에서 XML 읽기 → Isolate에서 컴파일 → 디코딩 → 화면

두 번째 사용:
  .asset('icon.svg')
  → 1단계 캐시 히트! → 2단계 캐시 히트! → 화면
  (디스크 I/O, XML 파싱, 컴파일, 디코딩 전부 건너뜀)
```

---

## 매번 그리냐, 사진 찍어 재사용하냐

디코딩이 끝나면 `build()`에서 위젯 트리를 구성한다. 여기서 렌더링 전략이 갈림.

Picture 전략 (벡터) — 매 프레임마다 `canvas.drawPicture()`로 명령어를 재실행한다. 벡터라서 확대해도 다시 계산해서 깨끗하게 그림. 근데 명령어가 수천 개면 매 프레임마다 수천 개를 실행하니까 느려질 수 있다.

Raster 전략 (비트맵) — 최초 1회만 명령어를 실행해서 비트맵 이미지를 찍어둠. 이후에는 그 이미지를 화면에 붙이기만 한다. 빠르지만 확대하면 픽셀이 보임.

```
어떤 전략을 쓸까?

아이콘, 로고 → picture (작아서 성능 차이 미미, 다양한 크기로 쓰일 수 있음)
배경, 일러스트 → raster (크고 복잡, 고정 크기에서 성능 이점)
```

`SvgPicture` 경유 시 기본값은 picture다. 아이콘이나 로고 같은 작은 SVG에 많이 쓰이니까, 다양한 크기로 쓰여도 선명한 게 더 중요함.

---

## 세 가지 상태를 넘나드는 build()

렌더링 엔진은 내부에 두 변수로 상태를 관리한다:

- `_pictureInfo != null` → 성공 (SVG 표시)
- `_error != null` → 에러 (`errorBuilder` 호출)
- 둘 다 null → 로딩 중 (`placeholderBuilder` 호출)

성공 분기에서 만들어지는 위젯 트리:

```
Semantics (접근성 정보)
  └─ imageBuilder (성공 시 래핑, 선택적)
       └─ SizedBox (사용자 지정 크기)
            └─ FittedBox (스케일/정렬)
                 └─ SizedBox.fromSize (SVG 원본 크기)
                      └─ 렌더 위젯 (실제 Canvas에 그리기)
```

사용자가 width/height 중 하나만 지정하면 SVG 원본의 종횡비를 유지하며 나머지를 계산함. `FittedBox`가 지정된 공간에 맞게 SVG를 스케일하고 정렬한다.

RTL 언어에서 아이콘이 좌우 반전되어야 할 때는 `matchTextDirection: true`로 Transform을 추가함.

---

## 처음 로딩부터 화면 표시까지 한 눈에

```
SvgPicture.asset('icon.svg')
  │
  ▼ initializer list에서 SvgAssetLoader 생성
  │
  ▼ build() → createCompatVectorGraphic() → VectorGraphic 위젯 생성
  │
  ▼ didChangeDependencies()에서 비동기 로딩 시작
  │
  ├─ 2단계 캐시(Picture) 확인 → 히트면 즉시 setState() → 성공 분기
  │
  └─ 미스 → Loader.loadBytes() 호출
       │
       ├─ 1단계 캐시(SVG 컴파일) 확인 → 히트면 바이너리 즉시 반환
       │
       └─ 미스 → prepareMessage()로 원본 확보
            │    → 별도 Isolate에서 encodeSvg()로 바이너리 컴파일
            │    → 1단계 캐시에 저장
            │
            ▼ 바이너리를 코덱 + 리스너로 디코딩 → PictureInfo 완성
            │
            ▼ 2단계 캐시에 저장, count += 1
            │
            ▼ setState() → build() 재호출 → 성공 분기
                 │
                 ▼ 렌더 위젯 선택 (picture/raster)
                 │
                 ▼ SizedBox → FittedBox → SizedBox.fromSize 래핑
                 │
                 ▼ RenderObject.paint()에서 canvas.drawPicture()
                 │
                 ▼ GPU가 픽셀로 변환 → 화면에 표시
```

두 번째 사용 시에는 캐시 덕분에 로딩 → 컴파일 → 디코딩이 전부 건너뛰어져서 거의 즉시 표시됨.

---

## 테마가 SVG의 색상을 바꿀 수 있다

SVG에서 `currentColor`를 쓰면 외부에서 색상을 주입할 수 있다. `SvgTheme`이 이 역할을 함:

```dart
SvgTheme(
  currentColor: Colors.blue,
  fontSize: 14,
)
```

테마 적용 우선순위는 — 생성자에서 직접 지정한 theme > `DefaultSvgTheme` InheritedWidget > 기본값 (검정, 14px).

`DefaultSvgTheme`을 쓰면 하위 트리 전체에 테마를 한번에 적용할 수 있다:

```dart
DefaultSvgTheme(
  theme: SvgTheme(currentColor: Colors.blue),
  child: Column(children: [
    SvgPicture.asset('icon1.svg'),  // currentColor = 파란색
    SvgPicture.asset('icon2.svg'),  // currentColor = 파란색
  ]),
)
```

같은 SVG라도 테마가 다르면 캐시 키가 달라진다. 컴파일 결과가 다르기 때문.

더 세밀한 색상 제어가 필요하면 `ColorMapper`를 쓴다. `colorFilter`가 렌더링 시점에 전체 일괄 적용인 반면, `ColorMapper`는 파싱 시점에 개별 요소의 색상을 하나하나 변환함.

---

## 참고

- [flutter_svg 소스](https://github.com/flutter/packages/tree/main/third_party/packages/flutter_svg)
- [vector_graphics 소스](https://github.com/flutter/packages/tree/main/packages/vector_graphics)
