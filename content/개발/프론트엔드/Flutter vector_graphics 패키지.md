# 벡터 그래픽 렌더링 엔진이 바이트를 화면에 그리는 법

> SVG를 모르는 렌더링 엔진. 바이너리 데이터만 받아서 Canvas 명령어로 풀고, 캐싱하고, 화면에 그린다. 컴파일러와 사용자 인터페이스 사이에서 "그리기만 담당하는" 패키지의 구조.

#flutter #vector-graphics #rendering #canvas #caching #listener-pattern #binary-decoding

---

## 세 개의 패키지가 각자 역할을 나눴다

Flutter에서 SVG를 화면에 그리는 데는 패키지 네 개가 관여한다. 각자 맡은 일이 명확히 다르다:

```
vector_graphics_compiler       vector_graphics_codec       vector_graphics
──────────────────────        ──────────────────────      ────────────────
SVG XML → 바이너리 변환         바이너리 포맷 정의            바이너리 → 화면 렌더링
(컴파일러)                     (공유 프로토콜)               (런타임 엔진)

                                                          ↑ 이 문서의 주제

flutter_svg
────────────
사용자 인터페이스 (SvgPicture.asset, .network, ...)
위 세 패키지를 내부에서 조합해서 사용
```

핵심은 렌더링 엔진이 **SVG를 모른다**는 것이다. XML이 뭔지, `<path>` 태그가 뭔지 알 필요 없다. 누군가 미리 컴파일해둔 바이너리 데이터를 받아서 Canvas에 재생하기만 한다. 덕분에 SVG가 아닌 다른 벡터 포맷이 와도 컴파일러만 바꾸면 같은 엔진을 쓸 수 있다.

---

## VectorGraphic 위젯은 세 가지 상태를 넘나든다

이 패키지의 핵심은 `VectorGraphic`이라는 `StatefulWidget` 하나다. 비동기로 바이너리를 로딩하기 때문에 세 가지 상태가 있다:

```
_pictureInfo != null  → 성공 (벡터 그래픽 표시)
_error != null        → 에러 (errorBuilder 호출)
둘 다 null            → 로딩 중 (placeholderBuilder 호출)
```

위젯이 트리에 삽입되면 `didChangeDependencies()`에서 비동기 로딩이 시작된다. 이때 현재 환경 정보(locale, textDirection)를 수집한다. 같은 SVG라도 아랍어(RTL)와 한국어(LTR) 환경에서 다르게 그릴 수 있기 때문이다.

로딩은 백그라운드에서 진행된다. `unawaited()`로 Future를 기다리지 않고, 완료되면 `setState()`로 상태를 전환해서 `build()`를 다시 호출한다.

위젯에는 생성자가 두 개 있다:

```dart
const VectorGraphic({...})    // 공개 — 기본값 raster (성능 우선)
const VectorGraphic._({...})  // private — 기본값 picture (호환성 우선)
```

직접 사용하는 개발자에게는 raster가 좋은 기본값이고, `flutter_svg` 경유 시에는 picture가 좋은 기본값이다. 공개 생성자의 기본값을 바꾸면 기존 사용자에게 breaking change가 되므로 private 생성자를 별도로 둔다.

---

## BytesLoader는 데이터의 출처를 몰라도 된다

바이너리 데이터를 **어디서** 가져올지를 추상화하는 인터페이스다:

```dart
abstract class BytesLoader {
  Future<ByteData> loadBytes(BuildContext? context);
  Object cacheKey(BuildContext? context);
}
```

기본 제공되는 구현체:

| Loader | 소스 | 용도 |
|---|---|---|
| `AssetBytesLoader` | Flutter 에셋 번들 | 앱에 포함된 .vec 파일 |
| `NetworkBytesLoader` | HTTP URL | 서버에서 다운로드 |

`flutter_svg`는 여기에 자체 Loader를 만들어서 SVG 파싱과 바이너리 컴파일을 `loadBytes()` 안에서 처리한다. 렌더링 엔진 입장에서는 Loader가 SVG를 파싱하든, 파일을 읽든, 네트워크에서 받든 상관없다. `loadBytes()`가 `ByteData`를 돌려주기만 하면 된다.

이 추상화 덕분에 커스텀 Loader를 만들 수도 있다. 예를 들어 암호화된 벡터 파일을 복호화해서 반환하는 Loader, 또는 캐시 서버에서 먼저 확인하고 없으면 원본 서버에서 받는 Loader 같은 것이다.

---

## 코덱이 바이트를 읽고 리스너가 객체를 만든다

로딩이 끝나면 바이너리를 Flutter Canvas 명령어로 변환해야 한다. 여기에 **Listener 패턴**을 쓴다.

코덱(Codec)과 리스너(Listener)의 역할이 분리되어 있다:

```
코덱: 바이트를 순서대로 읽으면서 "뭘 해야 하는지" 알려주는 역할
리스너: 코덱의 지시를 받아서 실제 Flutter 객체를 만드는 역할
```

실제 흐름:

```
ByteData [0x01, 0x0A, 0x14, ...]
  │
  ▼
VectorGraphicsCodec.decode(data, listener)
  │
  ├─ onPaintObject()    → Paint 객체 생성 (색상, 선 굵기)
  ├─ onPathStart()      → Path 객체 생성
  ├─ onPathMoveTo()     → path.moveTo(x, y)
  ├─ onPathLineTo()     → path.lineTo(x, y)
  ├─ onPathFinished()   → 완성된 Path 저장
  ├─ onDrawPath()       → canvas.drawPath(path, paint)
  ├─ onImage()          → 내장 래스터 이미지 디코딩
  └─ onSaveLayer/Restore → canvas.saveLayer() / restore()
  │
  ▼
PictureRecorder.endRecording() → Picture 완성
```

리스너가 관리하는 리소스들:

```
_paints:   [Paint, Paint, ...]       색상, 선 굵기, 블렌드 모드
_paths:    [Path, Path, ...]         도형의 경로
_shaders:  [Shader, Shader, ...]     그라디언트
_images:   {id: Image, ...}          내장 이미지
```

모든 그리기 명령은 `PictureRecorder`에 녹화된다. 녹화가 끝나면 `Picture` + 원본 크기가 합쳐진 `PictureInfo`가 완성된다.

**이 분리의 장점:** 코덱은 바이트 읽기만 담당하니 플랫폼에 무관하다. 리스너만 바꾸면 같은 바이너리 포맷으로 다른 렌더러를 만들 수 있다. 테스트에서도 Mock 리스너를 넣으면 실제 Canvas 없이 디코딩을 검증할 수 있다.

---

## Raster는 도시락이고 Picture는 즉석 요리다

디코딩이 끝나면 화면에 그려야 한다. 두 가지 전략이 있다:

### Picture 전략

매 프레임마다 `canvas.drawPicture()`로 녹화된 명령어를 재실행한다.

```
프레임 1: 명령어 실행 → GPU가 픽셀로 변환
프레임 2: 명령어 실행 → GPU가 픽셀로 변환
프레임 3: 명령어 실행 → GPU가 픽셀로 변환
```

벡터이므로 확대해도 다시 계산해서 깨끗하다. 주문 때마다 요리하는 식당처럼 항상 신선하다. 하지만 명령어가 복잡하면 느려질 수 있다.

### Raster 전략

처음 한 번만 명령어를 실행해서 비트맵을 찍어두고 재사용한다.

```
최초: 명령어 실행 → 비트맵 생성 → 캐싱
이후: 캐싱된 비트맵 붙여넣기
이후: 캐싱된 비트맵 붙여넣기
```

미리 만든 도시락을 데워먹는 것과 같다. 빠르지만 확대하면 픽셀이 보인다.

```
어떤 전략을 쓸까?

아이콘, 로고 → picture (작아서 성능 차이 미미, 다양한 크기로 쓰일 수 있음)
배경, 일러스트 → raster (크고 복잡, 고정 크기에서 성능 이점)
애니메이션과 함께 → picture (크기 변하면 raster는 매번 새 비트맵 필요)
```

웹 플랫폼에서는 전략과 무관하게 별도의 웹 전용 렌더링 경로를 탄다. 브라우저 네이티브 렌더링을 활용하기 위해서다.

---

## 참조 카운팅으로 캐시의 수명을 관리한다

렌더링 엔진은 두 단계 캐시를 운영한다. 둘 다 **static**이라 앱 전체에서 공유되는 싱글톤이다.

### 로딩 중복 방지 캐시

같은 키로 동시에 여러 요청이 오면 첫 번째 요청의 Future를 공유한다. 같은 아이콘이 10개 동시에 마운트되어도 로딩은 한 번만 일어난다.

### Picture 캐시

디코딩 완료된 `PictureInfo`를 참조 카운팅으로 관리한다:

```
위젯 마운트:   count += 1
위젯 디스포즈: count -= 1
count == 0:   캐시에서 삭제 + picture.dispose() (GPU 메모리 해제)
```

캐시 키에 locale과 textDirection이 포함된다. 같은 바이너리라도 환경이 다르면 별개의 캐시 항목이다.

테스트에서는 `vg.waitForPendingDecodes()`로 진행 중인 디코딩이 끝날 때까지 기다릴 수 있다. 비동기 로딩 위젯의 골든 테스트에서 필수적이다. `pumpWidget()` 직후에는 placeholder만 보이니까, 이 메서드로 디코딩 완료를 기다린 후 스크린샷을 비교해야 한다.

---

## 참고

- [vector_graphics 소스](https://github.com/flutter/packages/tree/main/packages/vector_graphics)
- [vector_graphics_codec 소스](https://github.com/flutter/packages/tree/main/packages/vector_graphics_codec)
