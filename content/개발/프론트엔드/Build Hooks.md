---
title: "Build Hooks"
tags:
  - flutter
  - build-hooks
  - native-assets
  - ffi
  - dart
  - c-interop
  - performance
---

## 가끔은 Dart만으로 안 된다

Flutter로 대부분의 앱을 만들 수 있다. 근데 가끔 벽에 부딪히는 순간이 온다.

- 이미지를 실시간으로 필터링하는데 Dart가 너무 느림
- SQLite 같은 C 라이브러리를 직접 써야 함
- 블루투스, 카메라 같은 하드웨어에 접근해야 함
- ML 모델 추론을 돌려야 하는데 프레임이 떨어짐

이럴 때 C/C++ 코드를 Flutter에 연결해야 한다. 문제는 그 "연결"이라는 게 지옥이었다는 거다.

---

## 예전에는 플랫폼마다 빌드를 따로 설정했다

C 함수 하나를 Dart에서 호출하려면 이런 과정을 거쳐야 했다:

```
[기존 방식: 플랫폼별 설정 지옥]

내 C 코드 (add.c)
     │
     ├── Android → build.gradle에 NDK 경로 설정 (Groovy 문법)
     ├── iOS     → .podspec에 소스 경로 추가 (Ruby 문법)
     ├── macOS   → 별도 .podspec 작성 (Ruby 문법)
     ├── Linux   → CMakeLists.txt 작성 (CMake 문법)
     └── Windows → CMakeLists.txt 작성 (CMake 문법)

+ 각 플랫폼에서 컴파일된 라이브러리를 찾는 dlopen() 코드도 따로:

  if (Platform.isAndroid) {
    lib = DynamicLibrary.open('libadd.so');
  } else if (Platform.isIOS) {
    lib = DynamicLibrary.process();
  } else if (Platform.isWindows) {
    lib = DynamicLibrary.open('add.dll');
  }
  // ... 끝도 없다
```

C 함수는 딱 한 줄(`int add(int a, int b)`)인데, 이걸 Flutter에 연결하려고 5개 빌드 시스템을 만져야 했다. Gradle은 Groovy, CocoaPods는 Ruby, CMake는 CMake 문법. Dart 개발자가 이걸 다 알아야 한다고?

패키지를 만드는 사람은 더 고통이었다. `pub.dev`에 FFI 패키지를 올리려면 5개 플랫폼 전부의 빌드 파일을 유지보수해야 했다. 하나라도 빠지면 그 플랫폼에서 빌드가 깨진다.

---

## Build Hooks: Dart 파일 하나가 전부를 대신한다

Flutter 3.38에서 도입된 **Build Hooks**는 이 지옥을 끝냈다. 프로젝트에 `hook/build.dart` 파일 하나만 만들면 된다.

```
[Build Hooks 방식]

내 C 코드 (add.c)
     │
     └── hook/build.dart  ← 이 Dart 파일 하나가 전부
           │
           ├── C 컴파일러를 자동으로 찾음 (Clang/MSVC)
           ├── 현재 빌드 타겟(Android/iOS/Windows 등)에 맞게 컴파일
           ├── 컴파일된 바이너리를 앱에 자동 번들링
           └── Dart에서 바로 호출 가능하도록 연결
```

Gradle 없음. Podspec 없음. CMakeLists.txt 없음. **Dart만 알면 된다.**

---

## 프로젝트 구조를 처음부터 따라가보자

```bash
flutter create --template=package_ffi my_math
```

이 명령 하나면 FFI 패키지 뼈대가 생긴다:

```
my_math/
  ├── lib/
  │   ├── my_math.dart                      ← 공개 API (사용자가 import)
  │   └── my_math_bindings_generated.dart   ← ffigen이 자동 생성
  ├── src/
  │   ├── my_math.c                         ← C 소스코드
  │   └── my_math.h                         ← C 헤더파일
  ├── hook/
  │   └── build.dart                        ← 빌드 훅 (핵심!)
  ├── ffigen.yaml                           ← 바인딩 생성 설정
  └── pubspec.yaml
```

각 파일이 하는 일을 하나씩 따라가보자.

### 1단계: C 코드를 작성한다

```c
// src/my_math.h
int add(int a, int b);
float fast_sqrt(float x);

// src/my_math.c
#include "my_math.h"

int add(int a, int b) {
    return a + b;
}

float fast_sqrt(float x) {
    // 뉴턴-랩슨 고속 근사
    float guess = x / 2.0f;
    for (int i = 0; i < 10; i++) {
        guess = (guess + x / guess) / 2.0f;
    }
    return guess;
}
```

평범한 C 코드다. Flutter도 Dart도 모른다. 그냥 순수 C.

### 2단계: build.dart가 컴파일을 지시한다

```dart
// hook/build.dart
import 'package:hooks/hooks.dart';
import 'package:code_assets/code_assets.dart';
import 'package:native_toolchain_c/native_toolchain_c.dart';

void main(List<String> args) async {
  await build(args, (input, output) async {
    // "src/ 안의 C 파일을 컴파일해줘"
    final cBuilder = CBuilder.library(
      name: 'my_math',
      sources: ['src/my_math.c'],
    );
    await cBuilder.run(input: input, output: output);
  });
}
```

이게 전부다. `CBuilder`가 알아서 한다:
- 현재 OS에 맞는 C 컴파일러를 찾고 (macOS면 Clang, Windows면 MSVC)
- 타겟 아키텍처에 맞게 컴파일하고 (arm64, x64 등)
- 컴파일된 `.so`/`.dylib`/`.dll`을 앱에 번들링한다

`flutter run`을 치면 Flutter가 `hook/` 폴더를 감지하고, `build.dart`를 자동으로 실행한다. 별도 명령이 필요 없다.

### 3단계: Dart에서 C 함수를 호출한다

```dart
// lib/my_math.dart
import 'dart:ffi';

// "C의 add 심볼을 이 Dart 함수와 연결해줘"
@Native<Int32 Function(Int32, Int32)>(symbol: 'add')
external int add(int a, int b);

@Native<Float Function(Float)>(symbol: 'fast_sqrt')
external double fastSqrt(double x);
```

`@Native` 어노테이션이 핵심이다. "이 Dart 함수는 사실 C 함수야"라고 선언하는 거다. `dlopen()`이나 OS별 경로 분기가 없다. Build Hooks가 런타임에 자동으로 찾아준다.

### 4단계: 그냥 쓴다

```dart
import 'package:my_math/my_math.dart';

void main() {
  print(add(3, 5));        // 8
  print(fastSqrt(144.0));  // 12.0
}
```

C 함수를 Dart 함수처럼 호출한다. 직렬화 없음. 채널 없음. 그냥 함수 호출.

---

## MethodChannel과 완전히 다른 이유

기존에 네이티브 코드를 쓰는 방법이 아예 없었던 건 아니다. **MethodChannel**이 있었다. 근데 이건 "전화 통화" 같은 방식이다.

```
[MethodChannel — 전화 통화 방식]

Dart: "add 해줘, 인자는 3이랑 5야" → 메시지 직렬화 → 플랫폼 채널 전송
                                                          │
네이티브: 메시지 역직렬화 → add(3, 5) 실행 → 결과 8 → 직렬화 → 전송
                                                          │
Dart: 역직렬화 → 결과 8을 받음

= 데이터가 복사되고 변환되는 횟수: 4번
```

```
[FFI + Build Hooks — 직접 만남 방식]

Dart: add(3, 5) → C 함수 직접 호출 → 결과 8

= 데이터 복사: 0번. 함수 호출 한 번.
```

MethodChannel은 비동기다. 메시지를 보내고 답장을 기다린다. FFI는 동기다. Dart 코드 안에서 C 함수가 바로 실행되고 결과가 바로 돌아온다.

단순한 호출 한 번이면 차이를 못 느낀다. 근데 프레임마다 수천 번 호출하는 물리 연산이나 이미지 처리에서는 이 차이가 프레임 드랍으로 이어진다.

---

## Zero-Copy: 메모리를 공유한다

FFI의 진짜 힘은 **메모리 공유**다. C가 할당한 메모리를 Dart가 복사 없이 직접 읽을 수 있다.

```
[데이터 복사 방식]
C: 배열 계산 완료 → [1.0, 2.5, 3.7, ...] → 복사 → Dart가 받음
                                              ↑ 이 복사가 느림

[Zero-Copy 방식]
메모리 한 블록: [1.0, 2.5, 3.7, ...]
                    ↑               ↑
              C가 여기에 쓴다    Dart가 여기서 읽는다
              (float*)          (Float32List)
```

```dart
// C가 할당한 메모리를 Dart가 직접 봄
final Pointer<Float> nativeData = callNativeFunction();
final Float32List dartView = nativeData.asTypedList(1000);
// dartView[0], dartView[1]... 복사 없이 바로 접근
```

2,000개 입자의 물리 시뮬레이션을 생각해보자. 프레임마다 모든 입자 위치를 C에서 계산하고 Dart(Flutter)가 화면에 그린다. 매 프레임마다 2,000개 × 2(x, y) = 4,000개 float을 복사하면 느리다. Zero-Copy면 C가 계산을 끝내는 순간 Dart가 바로 새 위치를 본다.

---

## 시스템 라이브러리도 연결된다

내가 만든 C 코드뿐 아니라, OS에 이미 설치된 시스템 라이브러리도 연결할 수 있다.

```dart
// hook/build.dart
void main(List<String> args) async {
  await build(args, (input, output) async {
    switch (input.target.os) {
      case OS.android || OS.iOS || OS.linux || OS.macOS:
        output.assets.code.add(CodeAsset(
          package: input.packageName,
          name: 'src/unix_bindings.dart',
          linkMode: LookupInProcess(),  // OS가 알아서 찾아줌
        ));
      case OS.windows:
        output.assets.code.add(CodeAsset(
          package: input.packageName,
          name: 'src/windows_bindings.dart',
          linkMode: DynamicLoadingSystem(Uri.file('ws2_32.dll')),
        ));
    }
  });
}
```

`LookupInProcess()`는 "이 함수가 이미 프로세스에 로드되어 있을 거야, 찾아봐"라는 뜻이다. Unix 계열 OS에서 표준 C 라이브러리 함수를 쓸 때 유용하다.

`DynamicLoadingSystem()`은 "OS에 설치된 이 DLL을 로드해줘"다. Windows의 `kernel32.dll`, `ws2_32.dll` 같은 시스템 DLL을 연결할 때 쓴다.

---

## 이미 컴파일된 라이브러리를 번들링한다

소스코드가 없는 상용 라이브러리(SDK)를 쓸 때도 Build Hooks가 처리한다. `.so`/`.dylib`/`.dll` 파일만 있으면 된다.

```dart
// hook/build.dart
void main(List<String> args) async {
  await build(args, (input, output) async {
    // 플랫폼별 미리 컴파일된 바이너리 경로
    final libFile = _getPrebuiltLib(
      input.target.os,
      input.target.architecture,
    );

    output.assets.code.add(CodeAsset(
      package: input.packageName,
      name: 'src/sdk_bindings.dart',
      linkMode: DynamicLoadingBundled(),
      file: libFile,
    ));
  });
}
```

URL에서 다운로드하는 것도 가능하다. build.dart가 Dart 코드니까 `http` 패키지로 다운로드 → 해시 검증 → 번들링 같은 로직을 자유롭게 짤 수 있다.

---

## ffigen이 바인딩을 자동 생성한다

C 헤더 파일을 읽고 Dart FFI 바인딩을 자동으로 만들어주는 도구가 `ffigen`이다.

```yaml
# ffigen.yaml
output: 'lib/bindings_generated.dart'
headers:
  entry-points:
    - 'src/my_math.h'
language: c
functions:
  include:
    - 'add'
    - 'fast_sqrt'
```

```bash
dart run ffigen
```

이러면 C 헤더에 선언된 함수들의 Dart 바인딩이 자동 생성된다. 함수가 50개여도 헤더만 있으면 50개 바인딩이 나온다. 손으로 `@Native` 어노테이션을 일일이 쓸 필요 없음.

---

## 전체 그림: 네이티브 코드 연결 방법 비교

```
┌──────────────────┬──────────────────┬──────────────────────┐
│                  │  MethodChannel   │  FFI + Build Hooks   │
├──────────────────┼──────────────────┼──────────────────────┤
│  통신 방식        │  메시지 전달 (비동기)│  함수 직접 호출 (동기) │
│  데이터 복사      │  직렬화/역직렬화   │  Zero-Copy 가능       │
│  성능             │  오버헤드 있음     │  네이티브급            │
│  빌드 설정        │  플랫폼별 각각     │  build.dart 하나      │
│  쓰기 좋은 상황    │  플랫폼 API 호출   │  고성능 연산, C 라이브러리│
│  네이티브 언어     │  Java/Swift/C++  │  C/C++ (Rust, Go도 가능)│
└──────────────────┴──────────────────┴──────────────────────┘
```

둘 다 여전히 유효한 방법이다. 카메라 권한 요청이나 푸시 알림 설정 같은 **플랫폼 API 호출**은 MethodChannel(또는 Pigeon)이 맞다. Java/Kotlin/Swift API를 써야 하니까.

C/C++ 라이브러리를 쓰거나, **연산 성능**이 중요한 경우에 FFI + Build Hooks를 쓴다.

---

## Flutter 개발자 입장에서 뭐가 달라지나

대부분의 Flutter 개발자는 `hook/build.dart`를 직접 쓸 일이 많지 않을 수 있다. 근데 이 구조를 아는 게 도움이 되는 이유가 있다.

**패키지를 고를 때** — 네이티브 코드가 필요한 패키지(SQLite, 암호화, ML 등)가 Build Hooks를 지원하면, 빌드 설정이 훨씬 간단해진다. 예전 방식 패키지는 Podfile이나 build.gradle을 수동으로 만져야 하는 경우가 있었다.

**빌드 에러를 만났을 때** — `hook/build.dart`가 있는 패키지에서 빌드가 실패하면, 그 파일을 열어보면 뭘 컴파일하려는 건지 Dart 코드로 읽을 수 있다. CMakeLists.txt나 Podspec을 해독하는 것보다 훨씬 접근하기 쉽다.

**성능 병목을 해결할 때** — Dart에서 아무리 최적화해도 안 되는 연산이 있다면, C로 핵심 루프만 짜고 Build Hooks로 연결하는 게 선택지가 된다. 이전에는 이 선택지의 진입 장벽이 너무 높았다.

---

## 삽질에서 건진 것들

Build Hooks가 동작하려면 시스템에 C 컴파일러가 설치되어 있어야 한다. macOS는 Xcode Command Line Tools에 Clang이 포함되어 있어서 보통은 문제없다. Windows는 Visual Studio Build Tools에서 MSVC를 설치해야 한다. "C 컴파일러를 못 찾겠다"는 에러가 나면 여기부터 확인하자.

iOS 빌드할 때 시뮬레이터와 실기기에서 라이브러리 이름이 달라지면 XCFramework 생성이 실패한다. `build.dart`에서 아키텍처별로 파일명을 바꾸는 실수를 하면 안 된다. output 디렉토리가 이미 아키텍처별로 분리되어 있으니까, 파일명은 동일하게 유지해야 한다.

`@Native` 어노테이션에서 C 타입과 Dart 타입을 매핑할 때 헷갈렸다. `int`는 `Int32`, `long long`은 `Int64`, `float`는 `Float`, `double`은 `Double`. C의 `int`가 플랫폼마다 크기가 다를 수 있으니까, 명시적으로 `int32_t`, `int64_t`를 쓰는 게 안전하다.

FFI는 동기 호출이라서 C 함수가 오래 걸리면 UI가 멈춘다. 무거운 연산은 `Isolate`에서 돌려야 한다. C 함수를 `Isolate.run()` 안에서 호출하면 메인 스레드를 블로킹하지 않는다.
