---
title: "게임 물리"
tags:
  - flutter
  - game-physics
  - velocity
  - gravity
  - collision
  - delta-time
  - vector
  - forge2d
  - flame
---

## 캐릭터가 점프하면 왜 다시 내려올까

[[Flame]]으로 게임을 만들다 보면 어느 순간 벽에 부딪힌다. 캐릭터를 오른쪽으로 이동시키는 건 됐다. 근데 점프를 시키면? 위로 올라갔다가 다시 내려와야 하고, 바닥에 닿으면 통통 튀어야 하고, 공이 벽에 맞으면 튕겨 나가야 한다. `position.y -= 5` 같은 식으로는 한계가 온다.

여기서 필요한 게 물리다. 속도, 가속도, 힘. 이 세 가지만 알면 된다.

```
실제 물리학:   복잡한 미분방정식, 유체역학, 열역학...
게임 물리:     v = v + a * dt   ← 사실상 이게 전부
```

게임은 현실을 시뮬레이션하는 게 아니다. "현실처럼 보이게" 속이는 거다. 플레이어가 "오 자연스럽다"고 느끼면 그걸로 충분하다.

---

## 시간을 쪼개야 움직임이 보인다

게임은 영화처럼 프레임의 연속이다. 1초에 60장의 그림을 빠르게 넘기면 움직이는 것처럼 보인다. 그리고 매 프레임마다 "이번에는 캐릭터를 얼마나 옮길까?"를 계산해야 한다.

여기서 **delta time(dt)** 이 등장한다. dt는 이전 프레임에서 지금 프레임까지 흐른 시간이다.

```
60fps일 때:  dt ≈ 0.016초 (1/60)
30fps일 때:  dt ≈ 0.033초 (1/30)
렉 걸릴 때:  dt ≈ 0.1초 이상
```

왜 이게 중요하냐면, 프레임마다 고정 값을 더하면 기기 성능에 따라 속도가 달라지기 때문이다.

```dart
// 나쁜 방법: 프레임마다 5픽셀씩
position.x += 5;
// 60fps 기기 → 초당 300px 이동
// 30fps 기기 → 초당 150px 이동 (느림!)

// 좋은 방법: 초당 300픽셀로 통일
position.x += 300 * dt;
```

핵심은 **프레임 수가 적으면, 한 프레임에서 더 많이 움직여서 보상한다**는 거다.

```
60fps (부드러운 기기)
1초 동안 60번 update() 호출

|·|·|·|·|·|·|·|·|·|·|  ← 한 칸에 4.8px씩, 촘촘하게 60번
├─────────────────────┤
         300px

30fps (느린 기기)
1초 동안 30번 update() 호출

|··|··|··|··|··|       ← 한 칸에 10px씩, 듬성듬성 30번
├─────────────────────┤
         300px
```

- 60fps → dt가 **작다**(0.016) → `300 * 0.016 = 4.8px` 조금씩 × 60번 = **300px**
- 30fps → dt가 **크다**(0.033) → `300 * 0.033 = 10px` 많이 × 30번 = **300px**

프레임이 적게 돌면 dt가 커지니까, 곱했을 때 한 번에 더 멀리 간다. 결과적으로 1초 뒤 도착 지점은 같다. dt를 곱하는 순간, 속도의 단위가 "프레임당 픽셀"에서 **"초당 픽셀"** 로 바뀌는 거다.

---

## 속도와 가속도
### 속도는 방향이 있다

"초당 100px"은 속도가 아니라 속력이다. 속도(velocity)는 **방향**이 포함된다. 오른쪽으로 100px/s, 위로 50px/s — 이런 식.

게임에서는 이걸 Vector2로 표현한다.

```dart
var velocity = Vector2(100, 0);   // 오른쪽으로 100px/s
var velocity = Vector2(0, -200);  // 위로 200px/s
var velocity = Vector2(50, 50);   // 오른쪽 아래 대각선
```

그리고 매 프레임마다 이 속도를 위치에 더한다.

```dart
@override
void update(double dt) {
  position += velocity * dt;
}
```

이게 **등속 운동**이다. 속도가 변하지 않으니까 직선으로 쭉 간다. 우주 공간에서 돌 던지면 이렇게 된다. 영원히 같은 방향, 같은 속도.

### 가속도가 곡선을 만든다

근데 현실에서 그런 건 없다. 공을 던지면 점점 느려지고, 떨어지는 물체는 점점 빨라진다. 이게 **가속도** 때문이다.

가속도는 속도의 변화율이다. 속도가 "위치를 얼마나 바꿀까"라면, 가속도는 "속도를 얼마나 바꿀까"다.

```dart
var velocity = Vector2(100, 0);
var acceleration = Vector2(0, 980);  // 아래로 중력

@override
void update(double dt) {
  velocity += acceleration * dt;  // 속도가 점점 바뀜
  position += velocity * dt;      // 바뀐 속도로 위치 이동
}
```

딱 두 줄이다. 이 두 줄로 포물선이 나온다.

```
대포알의 궤적:

  발사! →  ·
              ·
                ·         ← 수평 속도는 유지
                  ·
                    ·     ← 수직 속도가 점점 증가 (중력)
                      ·
                        ·
                    ──────── 바닥
```

처음엔 위로 올라가는 힘이 크니까 올라간다. 근데 중력이 계속 아래로 당기니까 올라가는 속도가 점점 줄고, 결국 0이 되고, 그다음부터 아래로 떨어진다. 이게 점프의 원리다.

```dart
// 점프 구현 — 핵심 원리
void jump() {
  velocity.y = -500;  // 위로 튀어오르는 초기 속도
}

@override
void update(double dt) {
  velocity.y += 980 * dt;  // 매 프레임 중력이 아래로 잡아당김
  position += velocity * dt;
}
```

점프 버튼을 누르면 velocity.y에 음수(위쪽)를 넣고, 매 프레임마다 중력이 양수(아래쪽)를 더한다. 자연스러운 포물선 완성.

---

## 충돌하면 뭐가 달라지나

### 벽에 부딪히면 속도가 뒤집힌다

공이 바닥에 닿으면 어떻게 해야 할까? 간단하다. 수직 속도를 반대로 뒤집으면 된다.

```dart
@override
void update(double dt) {
  velocity.y += gravity * dt;
  position += velocity * dt;

  // 바닥에 닿으면
  if (position.y > floorY) {
    position.y = floorY;       // 바닥 아래로 빠지지 않게
    velocity.y = -velocity.y;  // 수직 속도 반전 → 튀어오름
  }
}
```

근데 이러면 공이 영원히 같은 높이로 튀어오른다. 현실에서는 바운스할 때마다 에너지를 잃는다.

### 에너지 손실이 현실감을 준다

```dart
if (position.y > floorY) {
  position.y = floorY;
  velocity.y = -velocity.y * 0.8;  // 반사 + 20% 에너지 손실
}
```

0.8을 곱하면 튈 때마다 높이가 줄어든다. 이 숫자를 **반발 계수(restitution)** 라고 한다.

```
반발 계수에 따른 바운스:

1.0 (완전 탄성):  통통통통통통...  영원히 같은 높이
0.8 (고무공):     통통통통..       점점 낮아짐
0.5 (테니스공):   통통..           빠르게 멈춤
0.0 (찰흙):       퍽.              바로 멈춤
```

게임에서 이 값을 조절하면 오브젝트의 "재질감"이 달라진다. 같은 공이라도 0.9면 슈퍼볼, 0.3이면 물풍선 느낌이 난다.

```dart
// 사방에 벽이 있는 상자 안에서 공 튀기기
@override
void update(double dt) {
  velocity += gravity * dt;
  position += velocity * dt;

  if (position.x < 0 || position.x > screenWidth) {
    velocity.x = -velocity.x * 0.8;  // 좌우 벽
  }
  if (position.y < 0 || position.y > screenHeight) {
    velocity.y = -velocity.y * 0.8;  // 천장/바닥
  }
}
```

---

## 현실처럼 마찰구현하기

바운스만으로는 부족하다. 바닥을 구르는 공은 점점 느려져야 한다. 얼음 위에서 미끄러지는 캐릭터도 언젠간 멈춰야 한다.

```dart
// 단순 마찰: 매 프레임 속도를 조금씩 줄임
@override
void update(double dt) {
  velocity *= (1 - friction * dt);  // friction = 2.0 정도
  position += velocity * dt;
}
```

friction 값이 클수록 빨리 멈춘다.

```
마찰 계수에 따른 느낌:

friction = 0.5  → 얼음 위. 미끄러지듯 멀리 감
friction = 2.0  → 잔디 위. 적당히 멈춤
friction = 5.0  → 모래 위. 금방 멈춤
friction = 20   → 진흙. 거의 즉시 멈춤
```

마찰을 적절히 넣으면 캐릭터 이동이 훨씬 자연스러워진다. 키를 떼면 바로 멈추는 게 아니라, 살짝 밀리다가 멈추는 거다. 이런 미세한 차이가 "조작감이 좋다"는 느낌을 만든다.

---

## 힘과 질량 — 무거운 건 느리게 움직인다

지금까지는 가속도를 직접 넣었다. 근데 진짜 물리에서는 **힘(Force)** 이 있고, 그 힘이 질량에 따라 다르게 작용한다.

```
뉴턴의 제2법칙:  F = m × a
다시 쓰면:       a = F / m
```

같은 힘으로 밀어도 가벼운 건 멀리 가고, 무거운 건 조금 간다.

```dart
class PhysicsBody {
  Vector2 position;
  Vector2 velocity;
  Vector2 force = Vector2.zero();
  double mass;

  void applyForce(Vector2 f) {
    force += f;
  }

  void update(double dt) {
    // a = F / m
    final acceleration = force / mass;
    velocity += acceleration * dt;
    position += velocity * dt;
    force = Vector2.zero();  // 힘은 매 프레임 리셋
  }
}
```

이러면 같은 `applyForce`를 해도 mass가 1인 오브젝트는 확 날아가고, mass가 10인 오브젝트는 느릿느릿 움직인다.

```dart
// 바람 불 때
final wind = Vector2(200, 0);  // 오른쪽으로 부는 바람

feather.applyForce(wind);  // 깃털(mass: 0.1) → 확 날아감
rock.applyForce(wind);     // 바위(mass: 50)  → 거의 안 움직임
```

---

## 진동 — 흔들리고 튀는 것들

스프링에 매달린 물체, 좌우로 흔들리는 진자, 젤리처럼 출렁이는 UI. 이런 건 **진동(oscillation)** 이다.

가장 간단한 스프링 공식:

```
복원력 = -k × 변위
```

k는 스프링의 뻣뻣한 정도, 변위는 원래 위치에서 얼마나 벗어났는지다. 벗어날수록 원래 자리로 돌아가려는 힘이 세진다.

```dart
// 스프링 진동
final restPosition = 300.0;  // 원래 위치
final k = 150.0;             // 스프링 강도
final damping = 3.0;         // 감쇠 (안 넣으면 영원히 흔들림)

@override
void update(double dt) {
  final displacement = position.y - restPosition;
  final springForce = -k * displacement;
  final dampingForce = -damping * velocity.y;

  velocity.y += (springForce + dampingForce) * dt;
  position.y += velocity.y * dt;
}
```

damping이 없으면 진자처럼 영원히 왔다 갔다 한다. damping을 넣으면 점점 진폭이 줄어들면서 원래 위치에 안착한다.

```
스프링 움직임 (damping 있을 때):

    ↑ 위치
    |
    |   /\
    |  /  \      /\
    | /    \    /  \    /\
평형──/──────\/──────\/────\──→ 시간
    |                       ↘ 결국 멈춤
```

이건 게임뿐 아니라 앱 UI에서도 엄청 유용하다. Flutter의 `SpringSimulation`이 정확히 이 공식이다. 바텀시트가 스냅되는 동작, 오버스크롤 바운스, 드래그 후 되돌아오는 애니메이션 전부 스프링이다.

---

## 전체 공식 한 장 정리

```
┌─────────────────────────────────────────────┐
│              게임 물리 핵심 공식              │
├─────────────────────────────────────────────┤
│                                             │
│  등속 운동:                                  │
│    position += velocity * dt                │
│                                             │
│  가속 운동 (중력, 점프):                      │
│    velocity += acceleration * dt            │
│    position += velocity * dt                │
│                                             │
│  충돌 반사:                                  │
│    velocity = -velocity * restitution       │
│    (restitution: 0.0 ~ 1.0)                │
│                                             │
│  마찰:                                      │
│    velocity *= (1 - friction * dt)          │
│                                             │
│  힘 → 가속도:                               │
│    acceleration = force / mass              │
│                                             │
│  스프링:                                     │
│    force = -k * displacement - d * velocity │
│                                             │
└─────────────────────────────────────────────┘
```

이 여섯 가지를 조합하면 대부분의 2D 게임 물리를 만들 수 있다. 플랫포머의 점프, 핀볼의 반사, 앵그리버드의 포물선 전부 여기서 나온다.

---

## 직접 만들까 엔진 쓸까

### 직접 구현이 맞는 경우

위에서 본 공식들은 몇 줄이면 된다. 간단한 물리라면 직접 짜는 게 오히려 낫다.

- 캐릭터 점프, 중력, 기본 충돌
- 공 튀기기, 파티클 효과
- 단순한 물리 퍼즐

직접 짜면 **정확히 원하는 느낌**을 만들 수 있다. 중력을 2배로 올려서 묵직한 점프를 만든다거나, 반발 계수를 프레임마다 바꿔서 독특한 바운스를 만든다거나.

```dart
// Flame 컴포넌트에서 직접 물리 구현
class Ball extends PositionComponent with HasGameRef {
  Vector2 velocity = Vector2(200, -300);
  final double gravity = 980;
  final double restitution = 0.75;

  @override
  void update(double dt) {
    super.update(dt);
    velocity.y += gravity * dt;
    position += velocity * dt;

    final screenSize = gameRef.size;
    if (position.y > screenSize.y) {
      position.y = screenSize.y;
      velocity.y = -velocity.y * restitution;
    }
    if (position.x < 0 || position.x > screenSize.x) {
      velocity.x = -velocity.x * restitution;
    }
  }
}
```

### Forge2D가 필요한 경우

오브젝트가 여러 개 부딪히고, 모양이 복잡하고, 조인트로 연결되어야 한다면 직접 구현은 지옥이다.

- 여러 물체가 서로 밀어내는 시뮬레이션
- 복잡한 도형(다각형, 원) 간의 충돌 판정
- 체인, 로프, 관절 같은 연결 구조
- 핀볼, 브레이크아웃, 물리 퍼즐 게임

이런 경우 **Forge2D**(Flame의 2D 물리 엔진)를 쓰면 된다. Box2D를 Dart로 포팅한 라이브러리다.

```dart
// Forge2D에서는 Body를 만들고, World가 알아서 시뮬레이션
class PhysicsBall extends BodyComponent {
  @override
  Body createBody() {
    final shape = CircleShape()..radius = 20;
    final fixtureDef = FixtureDef(shape)
      ..density = 1.0        // 밀도 → 질량 결정
      ..restitution = 0.8    // 반발 계수
      ..friction = 0.3;      // 마찰

    final bodyDef = BodyDef()
      ..type = BodyType.dynamic
      ..position = Vector2(100, 100);

    return world.createBody(bodyDef)..createFixture(fixtureDef);
  }
}
```

Forge2D한테 "이 물체는 밀도 1, 반발 0.8, 마찰 0.3이야"라고 알려주면, 나머지 물리 계산은 엔진이 알아서 한다. 충돌 감지, 힘 전달, 회전까지 전부.

```
직접 구현 vs Forge2D:

직접 구현                          Forge2D
─────────                        ─────────
공 1개 튀기기         ✅ 간단      ❌ 과한 선택
캐릭터 점프/중력       ✅ 직관적    ❌ 설정이 많음
5개 물체 서로 충돌     ⚠️ 복잡해짐  ✅ 자동 처리
핀볼 게임             ❌ 지옥      ✅ 딱 맞는 용도
물리 퍼즐 (앵그리버드) ❌ 불가능급   ✅ 이거 위한 엔진
```

---

## Flutter 앱 개발에서 이게 왜 쓸모있나

게임 물리 공부가 게임할 때만 쓸모있는 건 아니다. Flutter 앱을 만들 때도 이 개념이 곳곳에 녹아있다.

**커스텀 애니메이션**: `AnimationController`의 `Curve`가 사실 가속도 그래프다. `Curves.bounceOut`은 반발 계수를 적용한 바운스고, `Curves.elasticOut`은 스프링 진동이다. 물리를 이해하면 커스텀 커브를 직접 설계할 수 있다.

**스크롤 물리**: `BouncingScrollPhysics`(iOS 스타일)는 오버스크롤 시 스프링 복원력을 적용하고, `ClampingScrollPhysics`(Android 스타일)는 마찰로 멈춘다. `ScrollPhysics`를 커스텀할 때 velocity, friction, spring 파라미터를 직접 조절하게 되는데, 이게 전부 게임 물리 공식이다.

**드래그 & 플링**: 카드를 손가락으로 튕기면 감속하며 날아가는 동작은 마찰 공식 그 자체다. `FrictionSimulation`이 이걸 처리한다.

**페이지 전환**: Hero 애니메이션의 자연스러운 곡선 이동도 가속도 기반이다. 시작할 때 가속, 끝날 때 감속 — `Curves.easeInOut`이 정확히 이거다.

```dart
// 물리 기반 애니메이션을 직접 만들고 싶을 때
final controller = AnimationController(vsync: this);
final simulation = SpringSimulation(
  SpringDescription(
    mass: 1.0,       // 질량
    stiffness: 200,  // 스프링 강도 (k)
    damping: 15,     // 감쇠 (d)
  ),
  0,    // 시작 위치
  1,    // 목표 위치
  0,    // 초기 속도
);
controller.animateWith(simulation);
```

결국 게임 물리를 공부하면 "이 애니메이션이 왜 이렇게 느껴지는지"를 이해하게 된다. 그러면 라이브러리가 제공하는 프리셋에 의존하지 않고, 원하는 느낌을 정확하게 만들어낼 수 있다.

#flutter #game-physics #forge2d
