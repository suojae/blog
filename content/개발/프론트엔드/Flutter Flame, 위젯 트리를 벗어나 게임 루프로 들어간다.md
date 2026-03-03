---
title: "Flutter Flame, 위젯 트리를 벗어나 게임 루프로 들어간다"
tags:
  - flutter
  - flame
  - game-engine
  - 2d-game
  - game-loop
  - component
  - sprite
  - collision
---

## 앱 개발자는 왜 게임 엔진을 알아야 할까

Flutter 개발하다 보면 "이건 위젯으로 못 하겠는데?" 싶은 순간이 온다. 캐릭터가 화면을 자유롭게 돌아다니거나, 수십 개 오브젝트가 동시에 움직이면서 서로 부딪히거나, 실시간으로 파티클이 튀어야 하는 상황. AnimationController 여러 개 돌리면서 CustomPainter로 끙끙대는 건 한계가 있다.

Flame은 Flutter 위에 올라가는 2D 게임 엔진이다. Flutter의 렌더링 파이프라인(Skia/Impeller)을 그대로 쓰면서, 게임에 필요한 것들 — 게임 루프, 스프라이트, 충돌 감지, 카메라 — 을 제공한다. 별도 언어나 빌드 시스템 없이, 지금 쓰는 Dart 코드 그대로 게임을 만들 수 있다는 얘기.

그리고 게임 아니어도 쓸 데가 있다. 인터랙티브 튜토리얼, 데이터 시각화, 복잡한 애니메이션 화면 같은 건 Flame의 게임 루프 방식이 위젯 방식보다 훨씬 자연스럽다.

---

## 근본적으로 사고방식이 다르다

일단 가장 큰 차이부터 짚고 가자. Flutter 앱 개발과 Flame 게임 개발은 머릿속 모델이 완전히 다르다.

```
Flutter 앱:
  "이 상태일 때 화면은 이렇게 생겨야 해" (선언적)
  상태 변경 → build() 호출 → 위젯 트리 재구성

Flame 게임:
  "이번 프레임에서 뭐가 바뀌어야 해?" (명령적)
  매 프레임(~60fps) → update(dt) → render(canvas)
```

앱에서는 `setState()` 호출하면 프레임워크가 알아서 바뀐 부분만 다시 그린다. 게임에서는 매 프레임마다 내가 직접 "이 캐릭터를 dt초만큼 오른쪽으로 옮겨" 하고, 그다음 캔버스에 "여기에 그려" 하는 거다.

이게 비유하면 이런 거다:

- **Flutter 앱** = 무대 감독. "1막은 이 세트, 2막은 저 세트" 하고 지시하면 스태프가 세트를 바꿔줌.
- **Flame 게임** = 애니메이터. 1초에 60장씩 그림을 직접 그려서 움직이는 것처럼 보이게 함.

---

## 게임 루프가 심장이다

모든 건 게임 루프에서 시작한다. Flutter 앱은 유저가 뭔가 할 때만 반응하지만, 게임은 유저가 아무것도 안 해도 계속 돌아간다. 적이 다가오고, 배경이 스크롤되고, 파티클이 날린다.

```dart
import 'package:flame/game.dart';
import 'package:flutter/widgets.dart';

void main() {
  runApp(GameWidget(game: MyGame()));
}

class MyGame extends FlameGame {
  @override
  Color backgroundColor() => const Color(0xFF222222);

  @override
  Future<void> onLoad() async {
    // 에셋 로딩, 초기 컴포넌트 추가
    await world.add(Player());
  }

  @override
  void update(double dt) {
    super.update(dt); // 모든 자식 컴포넌트에 전파
    // 게임 전체 로직
  }
}
```

`FlameGame`이 루트 컴포넌트이자 진입점이다. `GameWidget`이라는 Flutter 위젯이 이 게임을 호스팅한다. Flutter의 세계와 Flame의 세계를 연결하는 다리인 셈이다.

`update(double dt)` — 여기서 `dt`는 이전 프레임 이후로 흐른 시간(초). 60fps면 약 0.016초. 이걸 곱해서 움직임을 계산하면 프레임 속도에 관계없이 일정한 속도가 나온다.

---

## 컴포넌트 — 게임판 위의 모든 것

Flame에서는 모든 게 **컴포넌트**다. 플레이어, 적, 배경, 총알, 이펙트 — 전부. 이 컴포넌트들이 트리를 이룬다. Flutter의 위젯 트리와 비슷한데, 차이가 있다면 이 트리는 변경 가능(mutable)하고 명령적(imperative)이다.

```
FlameGame (루트)
  ├── CameraComponent (기본 제공)
  │     ├── Viewport
  │     └── Viewfinder
  └── World (게임 오브젝트가 사는 곳)
        ├── Player (PositionComponent)
        │     └── RectangleHitbox
        ├── Enemy (SpriteAnimationComponent)
        │     └── CircleHitbox
        └── Background (ParallaxComponent)
```

자식 컴포넌트는 부모의 좌표계를 기준으로 배치된다. 부모를 옮기면 자식도 같이 움직임. 로봇 팔에 손이 달려있는 것처럼.

### 컴포넌트 생명주기

모든 컴포넌트는 이 순서를 거친다:

```
생성자 → onGameResize → onLoad → onMount → [update + render 반복] → onRemove
```

```dart
class Player extends SpriteComponent with HasGameReference<MyGame> {
  @override
  Future<void> onLoad() async {
    // 에셋 로딩은 여기서. 비동기 OK.
    sprite = await game.loadSprite('player.png');
    size = Vector2(64, 64);
    anchor = Anchor.center;
    position = Vector2(200, 300);
  }

  @override
  void update(double dt) {
    super.update(dt);
    // 매 프레임 실행
    position.x += speed * dt;
  }

  @override
  void onRemove() {
    // 정리 작업
    super.onRemove();
  }
}
```

- `onLoad()` — 딱 한 번 호출. 스프라이트 로딩 같은 비동기 작업은 여기서.
- `onMount()` — `onLoad` 끝나고 트리에 붙을 때. 다른 부모로 옮기면 또 호출됨.
- `update(dt)` — 매 프레임. 상태 변경 로직.
- `render(canvas)` — 매 프레임, update 후. 화면에 그리기.
- `onRemove()` — 트리에서 빠질 때. 리소스 정리.

---

## 세상은 좌표로 이루어져 있다

Flutter 앱에서는 위젯의 위치를 Flex, Stack, Padding으로 잡지. Flame에서는 직접 좌표를 찍는다. "이 캐릭터는 (200, 300)에 있어."

좌표는 **월드 좌표**(논리적 단위)이고, `CameraComponent`가 이걸 화면 좌표로 변환한다. 맵이 넓으면 카메라가 플레이어를 따라다니면서 보여주는 영역을 바꾸는 거다.

```dart
class MyGame extends FlameGame {
  @override
  Future<void> onLoad() async {
    final player = Player();
    await world.add(player);

    // 카메라가 플레이어를 따라감
    camera.follow(player);

    // 카메라가 월드 밖으로 나가지 않게 제한
    camera.setBounds(
      Rectangle.fromLTRB(0, 0, worldWidth, worldHeight),
    );
  }
}
```

픽셀아트처럼 해상도를 고정하고 싶으면:

```dart
final myGame = FlameGame(
  camera: CameraComponent.withFixedResolution(
    width: 320,
    height: 240,
  ),
  world: MyWorld(),
);
```

320×240 해상도의 세상을 만들고, 실제 화면 크기에 맞춰서 자동으로 스케일링해준다. 레트로 게임 스타일 만들 때 딱 맞다.

카메라의 유용한 속성들:
- `camera.viewfinder.zoom` — 줌 레벨
- `camera.viewfinder.angle` — 회전
- `camera.visibleWorldRect` — 지금 화면에 보이는 영역 (최적화에 씀)
- `camera.canSee(component)` — 이 컴포넌트가 화면에 보이나?

---

## 스프라이트 — 게임의 얼굴

네모 상자만으로 게임을 만들 순 없지. 이미지를 입혀야 한다. 그게 스프라이트.

### 한 장짜리 이미지

```dart
class PlayerComponent extends SpriteComponent with HasGameReference<MyGame> {
  @override
  Future<void> onLoad() async {
    sprite = await game.loadSprite('player.png');
    size = Vector2(64, 64);
    position = Vector2(100, 100);
  }
}
```

이미지는 `assets/images/` 폴더에 넣고 `pubspec.yaml`에 등록한다:

```yaml
flutter:
  assets:
    - assets/images/
```

### 스프라이트 시트 — 한 장에 여러 프레임

캐릭터가 걷는 모습을 표현하려면 프레임 여러 장이 필요하다. 이걸 하나의 큰 이미지에 격자로 배치한 게 스프라이트 시트.

```
┌──┬──┬──┬──┬──┬──┬──┐
│걷1│걷2│걷3│걷4│걷5│걷6│걷7│  ← 행 0: 걷기 애니메이션
├──┼──┼──┼──┼──┼──┼──┤
│뛰1│뛰2│뛰3│뛰4│뛰5│뛰6│뛰7│  ← 행 1: 뛰기 애니메이션
└──┴──┴──┴──┴──┴──┴──┘
```

```dart
@override
Future<void> onLoad() async {
  final spriteSheet = SpriteSheet(
    image: await images.load('character_sheet.png'),
    srcSize: Vector2(16, 18), // 프레임 하나의 크기
  );

  // 행 0의 프레임 0~6번으로 걷기 애니메이션 생성
  final walkAnimation = spriteSheet.createAnimation(
    row: 0,
    stepTime: 0.1, // 프레임 하나당 0.1초
    to: 7,
  );

  final character = SpriteAnimationComponent(
    animation: walkAnimation,
    position: Vector2(150, 100),
    size: Vector2(80, 90),
  );
  add(character);
}
```

### 상태별 애니메이션 — 대기, 걷기, 뛰기

실제 게임에서는 캐릭터 상태에 따라 다른 애니메이션을 보여줘야 한다. `SpriteAnimationGroupComponent`가 이걸 해결한다.

```dart
enum PlayerState { idle, running, jumping }

class AnimatedPlayer extends SpriteAnimationGroupComponent
    with HasGameReference<MyGame> {
  @override
  Future<void> onLoad() async {
    final idleAnim = await game.loadSpriteAnimation(
      'player_idle.png',
      SpriteAnimationData.sequenced(
        amount: 4,        // 프레임 수
        stepTime: 0.15,   // 프레임당 시간
        textureSize: Vector2(32, 32),
      ),
    );
    final runAnim = await game.loadSpriteAnimation(
      'player_run.png',
      SpriteAnimationData.sequenced(
        amount: 6,
        stepTime: 0.1,
        textureSize: Vector2(32, 32),
      ),
    );

    animations = {
      PlayerState.idle: idleAnim,
      PlayerState.running: runAnim,
    };
    current = PlayerState.idle;
    size = Vector2(64, 64);
  }

  void run() => current = PlayerState.running;
  void stop() => current = PlayerState.idle;
}
```

`current`만 바꾸면 애니메이션이 자동 전환된다. 상태 머신을 직접 만들지 않아도 되니까 편하다.

---

## 터치와 키보드 — 유저 입력 받기

### 터치 (탭, 드래그)

컴포넌트에 `TapCallbacks` 믹스인을 붙이면 그 컴포넌트를 탭했을 때 반응한다.

```dart
class Coin extends CircleComponent with TapCallbacks {
  Coin() : super(radius: 20, paint: Paint()..color = Colors.yellow);

  @override
  void onTapDown(TapDownEvent event) {
    // 동전 터치됨! 점수 추가하고 사라지기
    removeFromParent();
  }
}
```

드래그는 `DragCallbacks`:

```dart
class DraggablePaddle extends RectangleComponent with DragCallbacks {
  @override
  void onDragUpdate(DragUpdateEvent event) {
    // 손가락 따라 좌우로 이동
    position.x += event.localDelta.x;
  }
}
```

### 키보드 입력

키보드는 두 가지 방식이 있다. 게임 전체에서 받거나, 특정 컴포넌트에서 받거나.

컴포넌트 단위가 더 깔끔하다. 게임에 `HasKeyboardHandlerComponents`를 붙이고, 컴포넌트에 `KeyboardHandler`를 붙인다:

```dart
class MyGame extends FlameGame with HasKeyboardHandlerComponents {
  // 키보드 시스템 활성화
}

class Player extends SpriteComponent with KeyboardHandler {
  final Vector2 velocity = Vector2.zero();
  static const double speed = 200;

  @override
  bool onKeyEvent(KeyEvent event, Set<LogicalKeyboardKey> keysPressed) {
    velocity.setZero();

    if (keysPressed.contains(LogicalKeyboardKey.arrowLeft)) {
      velocity.x = -speed;
    }
    if (keysPressed.contains(LogicalKeyboardKey.arrowRight)) {
      velocity.x = speed;
    }
    if (keysPressed.contains(LogicalKeyboardKey.arrowUp)) {
      velocity.y = -speed;
    }
    if (keysPressed.contains(LogicalKeyboardKey.arrowDown)) {
      velocity.y = speed;
    }
    return true; // true면 다른 핸들러에도 전파
  }

  @override
  void update(double dt) {
    super.update(dt);
    position += velocity * dt; // dt를 곱해야 프레임 독립적
  }
}
```

여기서 `velocity * dt`가 중요한데 — 60fps든 30fps든 같은 속도로 움직이게 해주는 거다. `dt`를 안 곱하면 프레임 속도 높은 기기에서 캐릭터가 더 빨리 움직여버린다.

---

## 충돌 감지 — 부딪히면 뭔가 일어나야지

게임에서 "총알이 적에 맞았다"를 어떻게 아나? 충돌 감지(Collision Detection)로.

세 단계로 세팅한다:

1. 게임에 `HasCollisionDetection` 붙이기
2. 컴포넌트에 히트박스(Hitbox) 추가하기
3. `CollisionCallbacks`로 충돌 시 행동 정의하기

```dart
class MyGame extends FlameGame with HasCollisionDetection {
  // 충돌 시스템 활성화됨
}

class Bullet extends RectangleComponent {
  @override
  Future<void> onLoad() async {
    add(RectangleHitbox(collisionType: CollisionType.passive));
  }
}

class Enemy extends SpriteComponent with CollisionCallbacks {
  int health = 3;

  @override
  Future<void> onLoad() async {
    add(RectangleHitbox()); // 기본은 active
  }

  @override
  void onCollisionStart(Set<Vector2> points, PositionComponent other) {
    super.onCollisionStart(points, other);
    if (other is Bullet) {
      health--;
      other.removeFromParent(); // 총알 제거
      if (health <= 0) {
        removeFromParent(); // 적 제거
      }
    }
  }
}
```

### CollisionType을 이해해야 성능이 나온다

```
active  — active끼리, active-passive 사이에 충돌 체크 (기본값)
passive — active가 확인해줄 때만 감지됨
inactive — 아예 충돌 안 함
```

총알이 100개고 적이 10개면? 총알끼리는 부딪힐 일이 없다. 총알을 `passive`로 설정하면 총알-총알 간 체크를 전부 스킵한다. 이것만으로도 충돌 연산이 확 줄어든다.

히트박스 종류: `RectangleHitbox`, `CircleHitbox`, `PolygonHitbox`(볼록 다각형만).

오브젝트가 100개 넘어가면 쿼드트리를 쓰자:

```dart
class MyGame extends FlameGame with HasQuadTreeCollisionDetection {
  @override
  void onLoad() {
    initializeCollisionDetection(
      mapDimensions: const Rect.fromLTWH(0, 0, 2000, 2000),
    );
  }
}
```

일반 충돌 감지는 O(n²)이지만 쿼드트리는 공간을 분할해서 근처에 있는 것끼리만 비교한다. 오브젝트 많은 게임에서는 필수.

---

## 이펙트 — 컴포넌트에 생명을 불어넣기

컴포넌트의 속성(위치, 크기, 회전, 투명도)을 시간에 따라 변화시키는 게 이펙트다. Flutter의 Tween 애니메이션과 비슷한 역할인데, 게임 루프 안에서 돌아간다.

```dart
// 2초에 걸쳐 (300, 200)으로 이동. ease-in-out 커브.
component.add(
  MoveEffect.to(
    Vector2(300, 200),
    EffectController(duration: 2, curve: Curves.easeInOut),
  ),
);

// 360도 회전을 무한 반복
component.add(
  RotateEffect.by(
    tau, // 2π
    EffectController(duration: 1, infinite: true),
  ),
);

// 커졌다 작아지기
component.add(
  ScaleEffect.by(
    Vector2.all(1.5),
    EffectController(duration: 0.3, reverseDuration: 0.3),
  ),
);
```

이펙트를 순서대로 연결하려면 `SequenceEffect`:

```dart
component.add(
  SequenceEffect([
    MoveEffect.by(Vector2(100, 0), EffectController(duration: 0.5)),
    ScaleEffect.by(Vector2.all(1.5), EffectController(duration: 0.3)),
    OpacityEffect.to(0, EffectController(duration: 0.3)),
  ]),
);
// 오른쪽 이동 → 커지기 → 사라지기. 순서대로 실행.
```

적이 총알에 맞았을 때 "뻥 터지면서 사라지는" 연출:

```dart
@override
void onCollisionStart(Set<Vector2> points, PositionComponent other) {
  if (other is Bullet) {
    other.removeFromParent();
    // 커지면서 투명해지다가 제거
    add(ScaleEffect.by(Vector2.all(2), EffectController(duration: 0.2)));
    add(OpacityEffect.to(0, EffectController(duration: 0.2),
      onComplete: removeFromParent,
    ));
  }
}
```

### 파티클 — 가벼운 시각 이펙트

폭발할 때 파편이 튀거나, 비가 내리거나. 한 번 쓰고 버리는 시각 효과에는 파티클이 맞다. 컴포넌트보다 가볍다.

```dart
// 폭발 파티클
game.add(
  ParticleSystemComponent(
    particle: AcceleratedParticle(
      speed: Vector2(100, -200),
      acceleration: Vector2(0, 400), // 중력
      child: CircleParticle(
        radius: 3,
        paint: Paint()..color = Colors.orange,
      ),
    ),
  ),
);
```

---

## Flutter 위젯과 같이 쓰기 — 오버레이

게임 만들면서 메뉴, 점수판, 일시정지 화면까지 전부 Canvas로 그릴 필요 없다. 그건 Flutter 위젯이 훨씬 잘한다. Flame의 **오버레이**가 이 둘을 연결해준다.

게임 캔버스 위에 Flutter 위젯을 올리는 거다:

```dart
GameWidget<MyGame>.controlled(
  gameFactory: MyGame.new,
  overlayBuilderMap: {
    'PauseMenu': (context, game) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('일시정지',
              style: TextStyle(fontSize: 40, color: Colors.white)),
            ElevatedButton(
              onPressed: () {
                game.overlays.remove('PauseMenu');
                game.resumeEngine();
              },
              child: const Text('계속하기'),
            ),
          ],
        ),
      );
    },
    'GameOver': (context, game) {
      return Center(
        child: Text('점수: ${game.score}',
          style: const TextStyle(fontSize: 32, color: Colors.white)),
      );
    },
  },
)
```

게임 코드에서 오버레이를 켜고 끄는 건 이렇게:

```dart
void pauseGame() {
  pauseEngine();
  overlays.add('PauseMenu');
}

void gameOver() {
  pauseEngine();
  overlays.add('GameOver');
}
```

이게 진짜 꿀인 게 — HUD는 Flutter 위젯으로, 게임 로직은 Flame 컴포넌트로 분리할 수 있다. 각자 잘하는 걸 시키는 거다.

`GameWidget`의 다른 유용한 옵션들:
- `loadingBuilder` — 게임 로딩 중에 보여줄 위젯
- `errorBuilder` — 에러 발생 시 위젯
- `backgroundBuilder` — 게임 캔버스 뒤에 깔 위젯

---

## 실전 패턴 — 이것만 알면 뭐든 만든다

### 적 일정 간격으로 스폰하기

```dart
class EnemySpawner extends Component with HasGameReference<MyGame> {
  final Random _random = Random();
  double spawnTimer = 0;

  @override
  void update(double dt) {
    super.update(dt);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      final x = _random.nextDouble() * 400 - 200;
      parent?.add(Enemy(position: Vector2(x, -250)));
      spawnTimer = 1.0 + _random.nextDouble(); // 1~2초 랜덤
    }
  }
}
```

타이머를 dt로 깎는 패턴. 게임에서 "n초마다 뭔가 하기"의 기본형이다.

Flame이 제공하는 `SpawnComponent`를 써도 된다:

```dart
add(
  SpawnComponent(
    factory: (index) => Enemy(),
    period: 1.5, // 1.5초마다
    area: Rectangle.fromLTWH(0, -50, game.size.x, 0),
  ),
);
```

### 프로젝트 폴더 구조

```
lib/
  main.dart                    # runApp(GameWidget)
  game/
    my_game.dart               # FlameGame 서브클래스
    my_world.dart              # World 서브클래스
  components/
    player.dart
    enemy.dart
    bullet.dart
  effects/
    explosion.dart
  utils/
    constants.dart             # 속도, 크기 등 상수
assets/
  images/
    player.png
    enemy_sheet.png
  audio/                       # flame_audio용
    bgm.mp3
    shoot.wav
```

---

## 성능 — 매 프레임 60번 실행된다는 걸 잊지 말자

Flutter 앱에서는 `build()`가 가끔 호출되니까 좀 무거워도 괜찮다. 근데 Flame의 `update()`와 `render()`는 **1초에 60번** 호출된다. 컴포넌트가 100개면 초당 6,000번. 여기서 매번 객체를 만들면 GC가 미친 듯이 돌아간다.

```dart
// 나쁜 예 — render()에서 매번 Paint 생성
void render(Canvas canvas) {
  canvas.drawRect(
    Rect.fromLTWH(0, 0, 10, 10),
    Paint()..color = Colors.red, // 프레임마다 새 Paint 객체!
  );
}

// 좋은 예 — 멤버 변수로 재사용
final _paint = Paint()..color = Colors.red;
final _rect = const Rect.fromLTWH(0, 0, 10, 10);

void render(Canvas canvas) {
  canvas.drawRect(_rect, _paint);
}
```

다른 팁들:
- `camera.visibleWorldRect`로 화면 밖 컴포넌트는 업데이트 스킵
- 충돌 많으면 `HasQuadTreeCollisionDetection` 사용
- 총알처럼 숫자 많은 건 `CollisionType.passive`로
- 안 보이게만 하려면 `removeFromParent()` 대신 `HasVisibility` 믹스인 (생명주기 재발동 방지)

---

## Flame 생태계 — 필요한 것만 골라 붙인다

Flame은 모듈형이다. 코어만 쓸 수도 있고, 필요한 패키지를 추가할 수도 있다.

| 패키지 | 역할 |
|---|---|
| `flame_audio` | 효과음, BGM |
| `flame_tiled` | 타일맵 에디터(Tiled)에서 만든 맵 로딩 |
| `flame_forge2d` | Box2D 기반 물리 엔진 |
| `flame_bloc` | Bloc 상태관리 연동 |
| `flame_riverpod` | [[Provider는 위젯 트리 바깥에 상태를 꺼내놓는 거다|Riverpod]] 연동 |
| `flame_rive` | Rive 애니메이션 |
| `flame_svg` | SVG 렌더링 |
| `flame_isolate` | 무거운 연산을 Isolate로 분리 |

전부 독립적이니까 필요한 것만 `pubspec.yaml`에 추가하면 된다.

---

## 직접 만들어 보면 — 미니 슈팅 게임

여기까지 설명한 개념들을 전부 엮으면 어떻게 되는지 보여줄게. 간단한 슈팅 게임이다.

```dart
import 'dart:math';
import 'package:flame/collisions.dart';
import 'package:flame/components.dart';
import 'package:flame/effects.dart';
import 'package:flame/events.dart';
import 'package:flame/game.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

void main() {
  runApp(
    MaterialApp(
      home: Scaffold(
        body: GameWidget<SpaceGame>.controlled(
          gameFactory: SpaceGame.new,
          overlayBuilderMap: {
            'GameOver': (context, game) => Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Game Over! 점수: ${game.score}',
                    style: const TextStyle(fontSize: 32, color: Colors.white)),
                  ElevatedButton(
                    onPressed: () {
                      game.overlays.remove('GameOver');
                      game.resetGame();
                    },
                    child: const Text('다시 하기'),
                  ),
                ],
              ),
            ),
          },
        ),
      ),
    ),
  );
}

// --- 게임 본체 ---
class SpaceGame extends FlameGame
    with HasCollisionDetection, HasKeyboardHandlerComponents {
  int score = 0;

  @override
  Color backgroundColor() => const Color(0xFF1A1A2E);

  @override
  Future<void> onLoad() async {
    await world.add(Player());
    await world.add(EnemySpawner());
    await world.add(ScreenHitbox());
  }

  void addScore(int points) => score += points;

  void gameOver() {
    pauseEngine();
    overlays.add('GameOver');
  }

  void resetGame() {
    score = 0;
    resumeEngine();
  }
}

// --- 플레이어 ---
class Player extends RectangleComponent
    with KeyboardHandler, HasGameReference<SpaceGame>, CollisionCallbacks {
  final Vector2 velocity = Vector2.zero();
  static const double speed = 300;
  double shootCooldown = 0;

  Player() : super(
    size: Vector2(40, 40),
    anchor: Anchor.center,
    paint: Paint()..color = Colors.cyan,
  );

  @override
  Future<void> onLoad() async {
    position = Vector2(0, 150);
    add(RectangleHitbox());
  }

  @override
  bool onKeyEvent(KeyEvent event, Set<LogicalKeyboardKey> keysPressed) {
    velocity.setZero();
    if (keysPressed.contains(LogicalKeyboardKey.arrowLeft)) velocity.x = -speed;
    if (keysPressed.contains(LogicalKeyboardKey.arrowRight)) velocity.x = speed;
    if (keysPressed.contains(LogicalKeyboardKey.space)) shoot();
    return true;
  }

  void shoot() {
    if (shootCooldown <= 0) {
      parent?.add(Bullet(position: position.clone() + Vector2(0, -30)));
      shootCooldown = 0.3; // 0.3초 쿨다운
    }
  }

  @override
  void update(double dt) {
    super.update(dt);
    position += velocity * dt;
    shootCooldown -= dt;
  }

  @override
  void onCollisionStart(Set<Vector2> points, PositionComponent other) {
    super.onCollisionStart(points, other);
    if (other is Enemy) game.gameOver();
  }
}

// --- 총알 ---
class Bullet extends RectangleComponent with CollisionCallbacks {
  Bullet({required Vector2 position}) : super(
    position: position,
    size: Vector2(4, 12),
    anchor: Anchor.center,
    paint: Paint()..color = Colors.yellow,
  );

  @override
  Future<void> onLoad() async {
    add(RectangleHitbox(collisionType: CollisionType.passive));
  }

  @override
  void update(double dt) {
    super.update(dt);
    position.y -= 500 * dt;
    if (position.y < -300) removeFromParent();
  }
}

// --- 적 ---
class Enemy extends RectangleComponent
    with CollisionCallbacks, HasGameReference<SpaceGame> {
  Enemy({required Vector2 position}) : super(
    position: position,
    size: Vector2(30, 30),
    anchor: Anchor.center,
    paint: Paint()..color = Colors.red,
  );

  @override
  Future<void> onLoad() async => add(RectangleHitbox());

  @override
  void update(double dt) {
    super.update(dt);
    position.y += 100 * dt;
    if (position.y > 300) removeFromParent();
  }

  @override
  void onCollisionStart(Set<Vector2> points, PositionComponent other) {
    super.onCollisionStart(points, other);
    if (other is Bullet) {
      game.addScore(10);
      other.removeFromParent();
      add(ScaleEffect.by(Vector2.all(2), EffectController(duration: 0.2)));
      add(OpacityEffect.to(0, EffectController(duration: 0.2),
        onComplete: removeFromParent));
    }
  }
}

// --- 적 생성기 ---
class EnemySpawner extends Component with HasGameReference<SpaceGame> {
  final Random _random = Random();
  double spawnTimer = 0;

  @override
  void update(double dt) {
    super.update(dt);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      parent?.add(Enemy(position: Vector2(
        _random.nextDouble() * 400 - 200, -250,
      )));
      spawnTimer = 1.0 + _random.nextDouble();
    }
  }
}
```

이 코드 하나에 지금까지 다룬 게 다 들어있다:
- `FlameGame` + `GameWidget` (게임 루프와 Flutter 연결)
- 컴포넌트 트리 (Player, Enemy, Bullet, Spawner)
- 키보드 입력 (`KeyboardHandler`)
- 충돌 감지 (`HasCollisionDetection` + `CollisionCallbacks`)
- 이펙트 (`ScaleEffect`, `OpacityEffect`)
- 오버레이 (Game Over 화면)

---

## Flutter 앱 개발자가 Flame을 쓸 때 유의할 점

| 앱 개발 습관 | Flame에서는 |
|---|---|
| `setState()`로 UI 갱신 | `update(dt)`에서 직접 상태 변경 |
| Navigator로 화면 전환 | 오버레이 또는 World 교체 |
| Padding, Flex로 레이아웃 | `Vector2`로 직접 좌표 지정 |
| `AnimationController` | `Effect` + `EffectController` |
| GestureDetector | `TapCallbacks`, `DragCallbacks` 믹스인 |
| 위젯 재사용 | 컴포넌트 상속과 믹스인 조합 |

가장 큰 함정 — `build()` 안에서 `GameWidget(game: MyGame())`을 쓰면 Flutter가 rebuild할 때마다 게임이 새로 생성된다. `GameWidget.controlled(gameFactory: MyGame.new)`를 쓰거나, 게임 인스턴스를 밖에서 만들어서 넘기자.

---

정리하면, Flame은 Flutter의 "선언적 UI" 세계에서 "매 프레임 직접 제어" 세계로 넘어가는 문이다. 위젯 트리가 아니라 컴포넌트 트리, build()가 아니라 update(dt), 레이아웃이 아니라 좌표. 이 사고 전환만 하면 나머지는 Flutter 개발 경험 그대로 쓸 수 있다.
