// 彩虹海 modification: regression coverage for smoothed navigation.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { data, specials } from '../src/universe/catalog.js';

let updateMotionPreference;
globalThis.matchMedia = () => ({
  matches: false,
  addEventListener(type, listener) {
    if (type === 'change') updateMotionPreference = listener;
  },
});
globalThis.innerWidth = 1440;
globalThis.innerHeight = 900;
const { createNavigation, wheelZoomFactor } = await import('../src/core/camera.js');

function fixture(clock) {
  const bodies = new Map(data.map(body => [body.id, {
    ...body,
    position: new THREE.Vector3(
      Math.cos(body.phase || 0) * body.orbit,
      0,
      Math.sin(body.phase || 0) * body.orbit,
    ),
  }]));
  const earth = bodies.get('earth');
  earth.group = new THREE.Group();
  earth.group.position.copy(earth.position);
  earth.position = earth.group.position;
  earth.mesh = new THREE.Object3D();
  earth.group.add(earth.mesh);
  bodies.get('moon').position.add(earth.position);
  const station = { position: earth.position.clone().add(new THREE.Vector3(-.9, .5, .9)) };
  const world = {
    bodies, earth, station,
    getData: id => bodies.get(id) || specials[id],
    getPosition(id, out = new THREE.Vector3()) {
      if (id === 'galaxy') return out.set(-18000, 0, 0);
      if (id === 'solar') return out.set(0, 0, 0);
      return out.copy(id === 'iss' ? station.position : bodies.get(id).position);
    },
  };
  const camera = new THREE.PerspectiveCamera(43, 1.6, .001, 350000);
  const controls = { target: new THREE.Vector3(), minDistance: 1.13, maxDistance: 180000, enabled: true, update() {} };
  const info = [], stages = [], toasts = [];
  const navigation = createNavigation({ camera, controls, world, onInfo: id => info.push(id), onStage: stage => stages.push(stage), toast: text => toasts.push(text), clock });
  navigation.initialize();
  return { camera, controls, world, navigation, info, stages, toasts };
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: expected ${expected}, received ${actual}`);
}

test('every original destination completes an immediate flight at its original distance', async context => {
  for (const id of [...data.map(body => body.id), 'iss', 'solar', 'galaxy']) {
    await context.test(id, () => {
      const { navigation, controls, world, info } = fixture();
      navigation.flyTo(id, { immediate: true });
      assert.equal(navigation.getState().flight, true);
      assert.equal(controls.enabled, false);
      navigation.update(0, performance.now() + 2, () => {});
      navigation.updateStage();
      const expected = id === 'galaxy' ? 68000 : id === 'solar' ? 650 : id === 'iss' ? .88
        : world.getData(id).r * (id === 'saturn' ? 8.6 : id === 'sun' ? 5.5 : 4.65);
      near(navigation.getState().distance, expected, id + ' arrival distance');
      near(controls.target.distanceTo(world.getPosition(id)), 0, id + ' arrival target');
      assert.equal(navigation.getState().selected, id);
      assert.equal(navigation.getState().displayedId, id);
      assert.equal(navigation.getState().flight, false);
      assert.equal(controls.enabled, true);
      assert.equal(info.at(-1), id);
    });
  }
});

test('frame update calls the simulation once and follows orbital displacement exactly', () => {
  const { navigation, controls, camera, world } = fixture();
  const beforeCamera = camera.position.clone(), beforeTarget = controls.target.clone();
  const movement = new THREE.Vector3(.4, -.02, .15);
  let calls = 0;
  navigation.update(.025, performance.now(), dt => {
    calls++;
    assert.equal(dt, .025);
    world.earth.position.add(movement);
  });
  assert.equal(calls, 1);
  near(camera.position.distanceTo(beforeCamera.add(movement)), 0, 'camera orbital following');
  near(controls.target.distanceTo(beforeTarget.add(movement)), 0, 'target orbital following');
  const pausedCamera = camera.position.clone(), pausedTarget = controls.target.clone();
  navigation.update(.025, performance.now(), () => { calls++; });
  assert.equal(calls, 2);
  near(camera.position.distanceTo(pausedCamera), 0, 'paused camera');
  near(controls.target.distanceTo(pausedTarget), 0, 'paused target');
});

test('zoom clamps to control limits and interrupts an active flight', () => {
  const { navigation, controls } = fixture();
  navigation.flyTo('galaxy');
  navigation.zoom(.000001);
  near(navigation.getState().distance, controls.minDistance, 'minimum zoom');
  assert.equal(navigation.getState().flight, false);
  assert.equal(controls.enabled, true);
  navigation.zoom(1e20);
  near(navigation.getState().distance, controls.maxDistance, 'maximum zoom');
});

test('wheel input translates pixels, lines and pages into bounded zoom steps', () => {
  assert.equal(wheelZoomFactor(2, 1, 800), wheelZoomFactor(32, 0, 800));
  assert.equal(wheelZoomFactor(1, 2, 800), wheelZoomFactor(400, 0, 800));
  near(wheelZoomFactor(130, 0, 800) * wheelZoomFactor(-130, 0, 800), 1, 'opposite steps');
});

test('animated zoom accumulates repeated input and eases to its target independent of frame rate', () => {
  function advanceAt(fps, frames) {
    const { navigation } = fixture();
    const original = navigation.getState().distance;
    navigation.zoomBy(2);
    navigation.zoomBy(2);
    near(navigation.getState().distance, original, 'input does not jump the camera');
    for (let frame = 0; frame < frames; frame++) navigation.update(1 / fps, 1000, () => {});
    return navigation.getState().distance;
  }
  const intermediate = advanceAt(60, 6);
  assert.ok(intermediate > 4.65 && intermediate < 4.65 * 4);
  near(intermediate, advanceAt(120, 12), 'equal elapsed time');
  near(advanceAt(60, 60), 4.65 * 4, 'combined zoom destination');
});

test('fly to the opposite side of the Earth follows a continuous arc', () => {
  let time = 1000;
  const { navigation, camera, world } = fixture(() => time);
  camera.position.copy(world.earth.position).add(new THREE.Vector3(-3, 0, 0));
  navigation.focusEarth({ lat: 0, lon: 0, distance: 2 });
  time += 675;
  navigation.update(.016, time, () => {});
  const halfway = camera.position.clone().sub(world.earth.position);
  near(halfway.length(), Math.sqrt(6), 'mid-flight distance');
  near(halfway.x, 0, 'halfway around the globe');
  time += 675;
  navigation.update(.016, time, () => {});
  near(camera.position.x - world.earth.position.x, 2, 'arrive on the opposite side');
  assert.equal(navigation.getState().flight, false);
});

test('a new destination after a pause starts at the visible point and settles at the last choice', () => {
  let time = 1000;
  const { navigation, camera, controls, world } = fixture(() => time);
  navigation.flyTo('galaxy');
  time += 400;
  navigation.update(.016, time, () => {});
  const inFlight = camera.position.clone();
  navigation.update(0, time, () => {});
  near(camera.position.distanceTo(inFlight), 0, 'paused visual clock');
  navigation.flyTo('mars');
  navigation.flyTo('jupiter');
  near(camera.position.distanceTo(inFlight), 0, 'no jump on retarget');
  time += 1350;
  navigation.update(.016, time, () => {});
  navigation.updateStage();
  near(controls.target.distanceTo(world.getPosition('jupiter')), 0, 'last destination wins');
  assert.equal(navigation.getState().flight, false);
});

test('only settled overview arrivals announce navigation and a new flight clears the old status', () => {
  let time = 1000;
  const { navigation, toasts } = fixture(() => time);
  function advance(milliseconds) {
    time += milliseconds;
    navigation.update(.016, time, () => {});
    navigation.updateStage();
  }
  navigation.flyTo('galaxy');
  advance(2000);
  assert.equal(navigation.getState().stage, 'galaxy');
  assert.equal(navigation.getState().flight, true);
  assert.deepEqual(toasts.filter(Boolean), []);
  navigation.flyTo('saturn');
  advance(1350);
  assert.deepEqual(toasts.filter(Boolean), []);

  navigation.flyTo('galaxy');
  advance(2600);
  assert.match(toasts.at(-1), /进入银河系/);
  navigation.flyTo('saturn');
  assert.equal(toasts.at(-1), '');

  navigation.flyTo('iss');
  assert.match(toasts.at(-1), /正在接近/);
  advance(1350);
  assert.equal(toasts.at(-1), '');
});

test('the initial Earth fits inside a narrow portrait viewport', () => {
  const { navigation, camera } = fixture();
  const originalWidth = globalThis.innerWidth;
  try {
    globalThis.innerWidth = 320;
    camera.aspect = 320 / 844;
    navigation.initialize();
    const distance = navigation.getState().distance;
    const halfAngle = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const projectedHalfWidth = 1 / Math.sqrt(distance ** 2 - 1) / halfAngle;
    assert.ok(projectedHalfWidth < .90, 'globe clears both sides of the viewport');
  } finally {
    globalThis.innerWidth = originalWidth;
  }
});

test('Saturn stays selected and centered at its fitted portrait distance until zooming out', () => {
  const originalWidth = globalThis.innerWidth, originalHeight = globalThis.innerHeight;
  try {
    for (const [width, height] of [[320, 700], [390, 844]]) {
      let time = 1000;
      const { navigation, camera, controls, world } = fixture(() => time);
      globalThis.innerWidth = width;
      globalThis.innerHeight = height;
      camera.aspect = width / height;
      navigation.flyTo('saturn', { immediate: true });
      time += 2;
      navigation.update(.016, time, () => {});
      navigation.updateStage();
      const arrival = navigation.getState();
      assert.ok(arrival.distance > world.getData('saturn').r * 10, 'portrait ring fit exceeds the old close limit');
      assert.equal(arrival.selected, 'saturn');
      assert.equal(arrival.stage, 'earth');

      for (let frame = 0; frame < 30; frame++) {
        time += 16;
        navigation.update(.016, time, () => {});
      }
      near(controls.target.distanceTo(world.getPosition('saturn')), 0, 'tracking stays on Saturn');
      navigation.zoom(1.05);
      navigation.update(.016, time, () => {});
      navigation.updateStage();
      assert.equal(navigation.getState().selected, 'saturn', 'a small zoom step keeps the close view');
      near(controls.target.distanceTo(world.getPosition('saturn')), 0, 'small zoom remains centered on Saturn');
      navigation.zoom(1.5);
      navigation.update(.016, time, () => {});
      navigation.updateStage();
      assert.equal(navigation.getState().stage, 'solar');
      assert.equal(navigation.getState().selected, 'solar');
    }
  } finally {
    globalThis.innerWidth = originalWidth;
    globalThis.innerHeight = originalHeight;
  }
});

test('reduced motion settles an active flight and applies zoom immediately', () => {
  let time = 1000;
  const { navigation } = fixture(() => time);
  navigation.flyTo('galaxy');
  time += 200;
  navigation.update(.016, time, () => {});
  assert.equal(navigation.getState().flight, true);
  try {
    updateMotionPreference({ matches: true });
    navigation.update(.016, time, () => {});
    assert.equal(navigation.getState().flight, false);
    near(navigation.getState().distance, 68000, 'arrives without continuing the animation');
    navigation.zoomBy(2);
    near(navigation.getState().distance, 136000, 'reduced-motion zoom is immediate');
  } finally {
    updateMotionPreference({ matches: false });
  }
});

test('cancelFlight restores controls and preserves the current camera', () => {
  const { navigation, camera, controls } = fixture();
  navigation.flyTo('mars');
  const before = camera.position.clone();
  navigation.cancelFlight();
  assert.equal(navigation.getState().flight, false);
  assert.equal(controls.enabled, true);
  near(camera.position.distanceTo(before), 0, 'cancelled flight camera');
});

test('an unknown destination leaves navigation and camera state unchanged', () => {
  const { navigation, camera, controls, info } = fixture();
  const before = navigation.getState(), beforeCamera = camera.position.clone(), beforeTarget = controls.target.clone();
  navigation.flyTo('unknown');
  assert.deepEqual(navigation.getState(), before);
  near(camera.position.distanceTo(beforeCamera), 0, 'unknown destination camera');
  near(controls.target.distanceTo(beforeTarget), 0, 'unknown destination target');
  assert.deepEqual(info, []);
});

test('snapshot restores the original view, selection and control limits after Earth focus', () => {
  const { navigation, camera, controls, info, stages } = fixture();
  navigation.flyTo('saturn', { immediate: true });
  navigation.update(0, performance.now() + 2, () => {});
  navigation.updateStage();
  const original = navigation.getState(), saved = navigation.snapshot();
  navigation.focusEarth({ lat: 31.23, lon: 121.47 });
  navigation.update(0, performance.now() + 1900, () => {});
  navigation.restore(saved);
  assert.deepEqual(navigation.getState(), original);
  assert.deepEqual(camera.position.toArray(), saved.camera.position);
  assert.deepEqual(controls.target.toArray(), saved.camera.target);
  assert.equal(controls.minDistance, saved.camera.minDistance);
  assert.equal(controls.maxDistance, saved.camera.maxDistance);
  assert.equal(controls.enabled, saved.camera.enabled);
  assert.equal(info.at(-1), 'saturn');
  assert.equal(stages.at(-1), saved.lastMode);
});

test('restoring an interrupted flight preserves its remaining duration across a mode pause', context => {
  let now = 1000;
  context.mock.method(performance, 'now', () => now);
  const { navigation, camera, controls } = fixture();
  navigation.flyTo('galaxy');
  now += 650;
  navigation.update(0, now, () => {});
  const saved = navigation.snapshot();
  assert.equal(saved.flight.elapsed, 650);
  assert.equal(saved.flight.remaining, 1950);
  navigation.focusEarth({ lat: 0, lon: 0 });
  now += 10000;
  navigation.update(0, now, () => {});
  navigation.restore(saved);
  assert.deepEqual(camera.position.toArray(), saved.camera.position);
  assert.deepEqual(controls.target.toArray(), saved.camera.target);
  assert.equal(navigation.snapshot().flight.remaining, 1950);
  assert.equal(controls.enabled, false);
  now += 1949;
  navigation.update(0, now, () => {});
  assert.equal(navigation.getState().flight, true);
  now += 1;
  navigation.update(0, now, () => {});
  assert.equal(navigation.getState().flight, false);
  near(navigation.getState().distance, 68000, 'restored galaxy arrival');
});

test('Earth geographic focus follows texture coordinates and the existing mesh rotation', async context => {
  for (const [label, lat, lon, rotation, expected] of [
    ['Greenwich', 0, 0, 0, [1, 0, 0]],
    ['90° east', 0, 90, 0, [0, 0, -1]],
    ['north pole', 90, 0, 0, [0, 1, 0]],
    ['rotated Greenwich', 0, 0, Math.PI / 2, [0, 0, -1]],
  ]) {
    await context.test(label, () => {
      const { navigation, world, camera, controls } = fixture();
      world.earth.mesh.rotation.y = rotation;
      assert.equal(navigation.focusEarth({ lat, lon, distance: 1.13 }), true);
      navigation.update(0, performance.now() + 1900, () => {});
      const outward = camera.position.clone().sub(world.earth.position).normalize();
      near(outward.distanceTo(new THREE.Vector3(...expected)), 0, label + ' surface direction');
      near(camera.position.distanceTo(world.earth.position), 1.13, 'Earth focus distance');
      near(controls.target.distanceTo(world.earth.position), 0, 'Earth focus target');
      assert.equal(navigation.getState().focusBody, 'earth');
    });
  }
});

test('Earth focus clamps the requested distance and rejects invalid coordinates', () => {
  const { navigation } = fixture();
  assert.equal(navigation.focusEarth({ lat: NaN, lon: 0 }), false);
  assert.equal(navigation.getState().flight, false);
  navigation.focusEarth({ lat: 0, lon: 0, distance: .5 });
  navigation.update(0, performance.now() + 1900, () => {});
  near(navigation.getState().distance, 1.13, 'surface zoom safety limit');
});
