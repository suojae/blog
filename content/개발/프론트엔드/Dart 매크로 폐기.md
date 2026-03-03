---
title: "Dart 매크로 폐기"
tags:
  - dart
  - flutter
  - code-generation
  - build_runner
  - macro
  - augmentation
  - hot-reload
---

## 보일러플레이트라는 코스트

Flutter로 앱을 만들다 보면 똑같은 코드를 반복해서 쓰는 순간이 온다. JSON 파싱이 대표적이다.

```dart
class User {
  final String name;
  final int age;
  final String email;

  User({required this.name, required this.age, required this.email});

  factory User.fromJson(Map<String, dynamic> json) => User(
    name: json['name'],
    age: json['age'],
    email: json['email'],
  );

  Map<String, dynamic> toJson() => {
    'name': name,
    'age': age,
    'email': email,
  };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is User &&
          name == other.name &&
          age == other.age &&
          email == other.email;

  @override
  int get hashCode => name.hashCode ^ age.hashCode ^ email.hashCode;

  User copyWith({String? name, int? age, String? email}) => User(
    name: name ?? this.name,
    age: age ?? this.age,
    email: email ?? this.email,
  );
}
```

필드 3개짜리 모델인데 코드가 40줄이다. `fromJson`, `toJson`, `==`, `hashCode`, `copyWith`... 전부 기계적인 패턴이다. 필드 이름만 바꿔서 찍어내는 거. 모델이 20개면 이런 코드를 20번 쓴다.


---

## build_runner로 간소화하기

이 보일러플레이트를 자동으로 생성해주는 도구가 있다. `json_serializable`이나 `freezed` 같은 코드 생성기를 `build_runner`가 돌려준다.

```dart
// 네가 쓰는 코드 — user.dart
@freezed
class User with _$User {
  const factory User({
    required String name,
    required int age,
    required String email,
  }) = _User;

  factory User.fromJson(Map<String, dynamic> json) => _$UserFromJson(json);
}
```

```bash
# 이 명령을 치면
dart run build_runner build
```

```dart
// 자동 생성됨 — user.freezed.dart, user.g.dart
// fromJson, toJson, ==, hashCode, copyWith 전부 들어있음
// 이 파일은 손대지 않는다. 기계가 관리하는 영역.
```

어노테이션(`@freezed`, `@JsonSerializable`)을 붙여두면, `build_runner`가 소스 파일을 읽고 `.g.dart`, `.freezed.dart` 파일을 만들어준다. 구조를 그림으로 보면:

```
user.dart  ──▶  build_runner  ──▶  user.g.dart (JSON 직렬화)
(@freezed)     (코드 생성기 실행)    user.freezed.dart (copyWith, ==, hashCode)
```

## 근데 build_runner는 느리다

여기서 문제가 시작된다. 프로젝트가 작을 때는 몇 초면 끝나는데, 파일이 수백 개가 되면:

```
파일 1개 수정
     │
     ▼
dart run build_runner build
     │
     ├── 모든 파일을 스캔 (500개)
     ├── 모든 코드 생성기에 전부 넣음
     ├── 생성된 코드 전부 다시 작성
     │
     ▼
30초 ~ 2분 대기
```

**파일 하나 고쳤을 뿐인데 전체를 다시 돌린다.** 커피 한 잔 타고 올 시간이다. 하루에 수십 번 돌리면 생산성이 확 떨어진다.

이게 느린 이유는 `build_runner`의 설계 때문이다. 기본적으로 프로젝트의 모든 파일을 모든 코드 생성기에 입력으로 넣는다. 바뀐 파일이 뭔지 정확히 추적하는 게 아니라, "혹시 모르니까 전부 다시 돌리자"는 방식.

---

## build_runner가 2배 빨라졌다

Dart 팀이 `build_runner`의 **transitive import tracking을 완전히 재작성**했다. 쉽게 말하면, "어떤 파일이 바뀌면 그 파일에 의존하는 것만 다시 생성하자"는 캐싱 시스템이다.

```
[이전: build_runner < 2.10.4]
user.dart 수정 → 500개 파일 전부 재스캔 → 전부 재생성

[이후: build_runner 2.10.4+]
user.dart 수정 → user.dart만 재스캔 → user.g.dart만 재생성
```

3,000개 라이브러리가 있는 프로젝트에서 **코드 생성이 2배 빨라졌다**고 한다. `json_serializable`, `freezed`, `go_router` 쓰는 실제 프로젝트에서도 체감됨.

적용하려면 그냥 버전만 올리면 된다:

```yaml
dev_dependencies:
  build_runner: ^2.10.4   # 이거면 됨
```

watch 모드를 쓰면 더 편하다:

```bash
dart run build_runner watch
# 파일 저장할 때마다 바뀐 것만 자동으로 재생성
```

이전에는 watch 모드도 느려서 "그냥 수동으로 돌리는 게 낫다" 했는데, 캐싱이 적용되면서 watch 모드가 실용적이 됐다.

---

## 매크로라는 꿈..

build_runner가 빨라졌다고 해도, 근본적인 불편함은 남아있다:

```
1. 별도 명령어를 실행해야 한다 (dart run build_runner build)
2. .g.dart 파일이 생긴다 (git에 커밋? 무시? 매번 고민)
3. 코드와 생성된 파일이 동기화 안 되면 런타임 에러
4. 새 팀원이 프로젝트 받으면 "먼저 build_runner 돌려야 해요" 안내 필요
```

Dart 팀은 이 모든 문제를 한 방에 해결할 기능을 만들고 있었다. **매크로(Macros)**다. 아이디어는 이거였다:

```dart
// 매크로가 실현됐더라면
@JsonCodable()
class User {
  final String name;
  final int age;
}
// 끝. fromJson, toJson이 컴파일 시점에 자동 생성됨.
// .g.dart 파일 없음. build_runner 실행 안 해도 됨.
// IDE가 실시간으로 생성해서 자동완성까지 됨.
```

build_runner와 비교하면:

```
build_runner:
  코드 작성 → 저장 → 터미널에서 명령 실행 → 기다림 → .g.dart 생성 → 사용

매크로:
  코드 작성 → 즉시 사용 가능 (IDE가 실시간 처리)
```

React에서 TypeScript 쓰면 타입 체크가 실시간으로 되는 것처럼, 매크로는 코드 생성을 언어 자체에 내장하려는 시도였다. 외부 도구가 아니라 Dart 컴파일러가 직접 하는 거.

---

## 매크로는 핫 리로드를 망가뜨렸다

2년 넘게 개발했다. 프로토타입도 만들었고, `@JsonCodable`이라는 실험적 매크로까지 배포했다. 근데 2025년 1월, Dart 팀이 **공식적으로 매크로 개발을 중단**했다.

이유는 하나다. **핫 리로드가 느려졌다.**

매크로가 동작하려면 주변 코드를 의미적으로 분석(semantic introspection)해야 한다. "이 클래스에 필드가 뭐가 있지? 타입은 뭐지?" 같은 걸 파악해야 `fromJson`을 만들 수 있으니까.

```
[매크로의 딜레마]

매크로가 코드를 생성하려면
  → 주변 코드의 의미를 분석해야 함
    → 컴파일 과정에서 매크로를 실행해야 함
      → 코드가 바뀔 때마다 매크로를 다시 실행해야 함
        → 핫 리로드의 첫 단계(증분 컴파일)가 느려짐
          → 저장하고 0.5초 만에 반영되던 게 몇 초로 늘어남
```

핫 리로드는 Flutter의 핵심 경쟁력이다. 코드를 저장하면 앱 상태를 유지한 채로 화면이 즉시 바뀌는 거. 이게 있어서 UI를 빠르게 실험하고 디버깅할 수 있다. 매크로가 이걸 망가뜨리면 본말이 전도된다.

```
Dart 팀의 트레이드 오프 계산:

  왼쪽: 코드 생성 편의성 (매크로)
  오른쪽: 핫 리로드 속도 (Flutter의 정체성)

  결론: 핫리로드 속도가 더 중요
```

2년간의 작업을 접는 결정이었다. 커뮤니티에서는 아쉬워하면서도 "맞는 판단"이라는 반응이 많았다. 전 Flutter 팀 리더였던 Eric Seidel(Shorebird CEO)도 "초점을 맞추는 건 항상 좋은 일"이라고 평가했다.

---

## 매크로에서 건진 것들

매크로를 통째로 버린 건 아니다. 2년간 프로토타이핑하면서 만든 것 중 쓸 수 있는 부분을 쪼개서 살리고 있다.

### Augmentations — 클래스를 여러 파일로 나눈다

매크로에서 떨어져 나온 독립 기능이다. 하나의 클래스 정의를 여러 파일에 걸쳐 작성할 수 있게 해준다.

지금 `build_runner`가 `.g.dart` 파일을 생성하면 `part of` 지시자로 원본 파일에 연결하는데, 이 구조가 좀 어색하다. Augmentation이 도입되면 코드 생성기가 만드는 파일이 더 깔끔해진다.

```dart
// user.dart (네가 쓰는 코드)
class User {
  final String name;
  final int age;
}

// user.augmentation.dart (코드 생성기가 만드는 코드)
augment class User {
  factory User.fromJson(Map<String, dynamic> json) => User(
    name: json['name'],
    age: json['age'],
  );
}
```

`part of`보다 명확하고, IDE 지원도 더 좋아질 전망이다.

### 데이터 클래스 — 언어 차원에서 보일러플레이트 제거

Dart 팀이 가장 많이 받는 요청이 "데이터 클래스"다. Kotlin의 `data class`처럼 `==`, `hashCode`, `copyWith`, `toString`을 언어가 자동으로 만들어주는 기능.

```dart
// 아직 확정은 안 됐지만, 이런 방향
data class User {
  final String name;
  final int age;
}
// ==, hashCode, copyWith, toString이 자동 생성
```

이게 나오면 `freezed`를 쓰는 이유의 절반이 사라진다. 매크로 없이도, build_runner 없이도 보일러플레이트가 줄어드는 거다.

### build_runner 자체 개선

매크로가 취소되면서 오히려 build_runner 개선에 더 집중하게 됐다:

```
[이미 적용됨]
✓ transitive import tracking 재작성 (2배 속도 향상)
✓ 캐싱 시스템 (바뀐 파일만 재생성)
✓ watch 모드 개선

[진행 중 / 계획됨]
○ augmentation 기반의 더 깔끔한 코드 생성
○ 추가 성능 최적화
```

---

## 현재 코드 생성 생태계 정리

```
┌───────────────────────────────────────────────────────────┐
│  도구              │  하는 일              │  상태           │
├───────────────────────────────────────────────────────────┤
│  json_serializable │  fromJson/toJson 생성 │  현역 (안정적)   │
│  freezed           │  불변 모델 + JSON     │  현역 (3.0 출시) │
│  build_runner      │  코드 생성기 실행기     │  현역 (2배 빨라짐)│
│  매크로             │  언어 내장 코드 생성   │  취소됨          │
│  augmentations     │  클래스 분할 정의      │  개발 중         │
│  데이터 클래스       │  자동 ==, copyWith    │  검토 중         │
└───────────────────────────────────────────────────────────┘
```

---

## 실전에서 쓰는 build_runner 팁

### build.yaml로 범위 좁히기

코드 생성이 필요한 파일에 특정 접미사를 붙이고, 그 파일만 스캔하게 설정할 수 있다.

```yaml
# build.yaml
targets:
  $default:
    sources:
      - lib/**
      - test/**
    builders:
      json_serializable:
        generate_for:
          - lib/models/**  # models 폴더만 스캔
```

전체 `lib/`을 스캔하는 것보다 훨씬 빠르다.

### 코드 생성 파일 git 관리

두 가지 전략이 있다:

```
전략 1: .g.dart를 git에 커밋
  장점: clone 받으면 바로 빌드 가능
  단점: 코드 리뷰에 노이즈, 충돌 가능성

전략 2: .g.dart를 .gitignore에 추가
  장점: 깔끔한 git 히스토리
  단점: clone 후 build_runner 먼저 실행해야 함
```

팀 규모가 작으면 전략 2가 깔끔하다. CI에서 `dart run build_runner build`를 돌리면 되니까. 팀이 크면 전략 1이 마찰이 적다.

### freezed 3.0의 mixed mode

매크로가 취소된 직후 `freezed` 3.0이 나왔다. "mixed mode"라는 게 추가됐는데, build_runner 의존을 줄이면서도 기존 코드와 호환되는 방식이다. freezed를 쓰고 있다면 3.0으로 올려보는 게 좋다.

---

## 삽질에서 건진 것들

`build_runner build`를 돌렸는데 에러가 나서 `build_runner clean` 후 다시 돌렸더니 됐다. 캐시가 꼬인 거였다. 이상하게 동작하면 `clean`부터 해보자.

`.g.dart` 파일을 수동으로 수정한 적이 있다. 다음 `build_runner build`에서 덮어씌워져서 수정이 날아갔다. 생성된 파일은 절대 손대면 안 된다. 바꿔야 하면 원본 `.dart`를 수정하고 다시 생성.

매크로 프리뷰(`@JsonCodable`)를 써봤는데, 실험 채널에서만 돌아가고 안정 채널에서는 안 됐다. 매크로가 취소된 지금, 이 프리뷰 코드는 미래가 없다. 기존 `json_serializable` + `freezed` 조합이 당분간은 정답이다.

`build_runner watch`를 켜놓고 작업하다가 파일 수십 개를 한 번에 리팩토링했더니 watch가 폭주했다. 대규모 변경에는 watch보다 수동 `build`가 안전하다. watch는 파일 하나씩 수정하는 일상 개발용.
