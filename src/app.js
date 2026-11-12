// 彩虹海 modification: frame scheduling, wheel interaction and local diagnostics.
import { bindCompactUI } from './ui/compact.js';
import { createWallpaperRenderer } from './ui/wallpaper-renderer.js';
import * as THREE from 'three';
import { createRenderer, createPipeline } from './core/renderer.js';
import { createCamera, createNavigation, wheelZoomFactor } from './core/camera.js';
import { createWorld, updateWorldVisibility } from './core/scene.js';
import { loadTextures } from './core/textures.js';
import { data } from './universe/catalog.js';
import { createInfoPanel } from './ui/info-panel.js';
import { createLabels } from './ui/labels.js';
import { bindNavigationUI } from './ui/navigation.js';
import { toast, fail } from './ui/feedback.js';
import { createEarthSense } from './earthsense/index.js';
import { createEarthDetail } from './earth/detail.js';
import { mobile } from './core/math.js';

const EARTH_UPLOAD_IDLE_MS = 750;
const EARTH_UPLOAD_WAIT_MS = 12000;

export async function startOrbit() {
  let renderer, earthDetail, frame = 0, contextLost = false;
  window.addEventListener('error', event => {
    console.error(event.error || event.message);
    if (!renderer) fail('加载出现问题。请使用支持 WebGL 2 的新版 Chrome、Edge 或 Safari 打开此文件。');
  });
  try {
    renderer = createRenderer(document.getElementById('universe'), () => {
      contextLost = true;
      cancelAnimationFrame(frame);
      frame = 0;
      earthDetail?.dispose();
      fail('图形上下文已丢失。请关闭占用显卡的页面后，重新加载星空。');
    });
    const scene = new THREE.Scene();
    const { camera, controls } = createCamera(renderer);
    const { composer, resize, updateFraming } = createPipeline(renderer, scene, camera);
    const pixels = resize();
    const assets = window.ORBIT_ASSETS;
    const textures = await loadTextures(assets, fraction => {
      document.getElementById('load-progress').style.width = `${fraction * 90}%`;
    });
    const world = createWorld(scene, textures, pixels);
    let uploadEarthMap = null;
    function waitForEarthTextureFrame(signal) {
      return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        function release() {
          clearTimeout(deadline);
          signal.removeEventListener('abort', abort);
          uploadEarthMap = null;
        }
        function abort() {
          release();
          reject(signal.reason);
        }
        const deadline = setTimeout(() => {
          release();
          reject(new DOMException('地球纹理等待空闲帧超时', 'AbortError'));
        }, EARTH_UPLOAD_WAIT_MS);
        signal.addEventListener('abort', abort, { once: true });
        uploadEarthMap = () => {
          release();
          resolve();
        };
      });
    }
    earthDetail = createEarthDetail({
      world, renderer, assets, compact: mobile(), beforeUpload: waitForEarthTextureFrame,
    });
    const info = createInfoPanel({ getData: world.getData });
    let ui, earthsense, navigationTime = 0;
    const navigation = createNavigation({
      camera, controls, world, onInfo: info.update, toast: text => toast(text, 'navigation'),
      clock: () => navigationTime,
      onStage: mode => ui?.updateStage(mode),
    });
    const labels = createLabels({ camera, controls, world, onSelect: navigation.flyTo });
    ui = bindNavigationUI({ renderer, camera, world, navigation, assets, toast, controls,
      wallpaperView: createWallpaperRenderer({ renderer, composer, scene, world, textures, mainCamera: camera, resizeMain: () => resize(world) }),
      setSpaceColor: color => {
        scene.background = new THREE.Color(color);
        renderer.setClearColor(color);
        document.documentElement.style.setProperty('--space-color', color);
      },
      onPick: (raycaster, event) => earthsense?.pick(raycaster, event) || false,
    });
    renderer.domElement.addEventListener('wheel', event => {
      if (event.buttons || (ui.wallpaper.active && ui.wallpaper.isolated)) return;
      const mode = event.deltaMode;
      if (!event.deltaY) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      navigation.zoomBy(wheelZoomFactor(event.deltaY, mode, innerHeight));
    }, { capture: true, passive: false });
    world.update(0, ui.getState());
    navigation.initialize();
    earthsense = createEarthSense({ world, camera, controls, navigation, ui });
    bindCompactUI();
    resize(world);
    document.getElementById('load-progress').style.width = '100%';
    document.getElementById('load-text').textContent = '欢迎回到地球';
    await renderer.compileAsync(scene, camera);
    if (contextLost) return;
    updateWorldVisibility(world, camera, controls, ui.getState().orbitsVisible, navigation.getState());
    world.backgroundStars.position.copy(camera.position);
    composer.render();
    document.getElementById('loading').classList.add('done');
    setTimeout(() => document.getElementById('loading')?.remove(), 900);
    let lastFrameTime = performance.now(), nextLabelsAt = 0, nextHudAt = 0, observingEarth = false;
    let trajectoriesVisible = false;
    let resizePending = false;
    let lastInteraction = lastFrameTime, orbitGesture = false;
    const recordInteraction = () => { lastInteraction = performance.now(); };
    for (const event of ['pointerdown', 'pointerup', 'keydown', 'wheel']) {
      addEventListener(event, recordInteraction, { capture: true, passive: true });
    }
    controls.addEventListener('start', () => { orbitGesture = true; });
    controls.addEventListener('end', () => { orbitGesture = false; recordInteraction(); });

    function updateEarthDetail(now, navigationState) {
      if (!uploadEarthMap && earthDetail.status !== 'idle') return;
      if (orbitGesture || navigationState.flight || navigationState.focusBody !== 'earth'
        || navigationState.distance > 12 || now - lastInteraction < EARTH_UPLOAD_IDLE_MS) return;
      // Decoding can finish during input, but GPU uploads wait for an idle Earth view.
      if (uploadEarthMap) {
        lastInteraction = now;
        uploadEarthMap();
      } else {
        void earthDetail.prepare();
      }
    }

    function animate(now) {
      frame = requestAnimationFrame(animate);
      const dt = THREE.MathUtils.clamp((now - lastFrameTime) / 1000, 0, .05);
      lastFrameTime = now;
      if (resizePending) {
        resizePending = false;
        if (ui.wallpaper.active) ui.wallpaper.resize();
        else resize(world);
      }
      if (ui.wallpaper.active && ui.wallpaper.isolated) { ui.wallpaper.update(dt); return; }
      // Inactive tabs and long frames must not teleport an in-progress flight.
      navigationTime += dt * 1000;
      const settings = ui.getState();
      const navigationState = navigation.getState();
      const navigating = navigationState.flight;
      if (navigating) lastInteraction = now;
      const inTrajectories = navigationState.stage === 'trajectory';
      if (inTrajectories) trajectoriesVisible = true;
      else if (!navigating) trajectoriesVisible = false;
      // Keep the entire astronomical simulation intact while observing the surface.
      navigation.update(dt, navigationTime, () => world.update(dt, {
        ...settings, paused: earthsense.active || navigationState.returning || trajectoriesVisible || settings.paused,
      }));
      // Freeze both the model and any reference-frame transition while the
      // camera is borrowed, so EarthSense returns to exactly the saved view.
      world.motionTrajectories.update(navigating || earthsense.active || !inTrajectories ? 0 : dt, {
        active: trajectoriesVisible, speed: settings.speed,
        paused: settings.paused || navigating || earthsense.active || !inTrajectories,
      });
      world.backgroundStars.position.copy(camera.position);
      world.backgroundStars.visible = ui.wallpaper.starsVisible;
      world.flybys.update(dt, camera, {
        paused: settings.paused, enabled: !earthsense.active && !trajectoriesVisible, navigating,
      });
      navigation.updateStage();
      const visibleState = navigation.getState();
      updateWorldVisibility(world, camera, controls, settings.orbitsVisible, visibleState);
      if (!ui.wallpaper.satellitesVisible) {
        world.earthSatellites.visible = false;
        world.station.visible = false;
        world.earthOrbitGroup.visible = false;
      }
      if (trajectoriesVisible) {
        world.motionTrajectories.group.traverse(object => {
          if (object.name.startsWith('trajectory-trail-')) object.visible = settings.orbitsVisible && (object.material.uniforms.uGalactic.value > 0 || object.material.uniforms.uRadius.value > 0);
        });
      }
      if (earthsense.active) {
        earthsense.update(navigationTime / 1000, { scaleFactor: THREE.MathUtils.clamp(
          (camera.position.distanceTo(world.earth.position) - 1) / 3.65, .06, 1,
        ) });
      }
      if (observingEarth !== earthsense.visible) {
        observingEarth = earthsense.visible;
        earthDetail.setObservation(observingEarth);
      }
      updateFraming(observingEarth, dt);
      if (earthsense.visible) {
        world.earthSatellites.visible = false;
        world.station.visible = false;
        world.earthOrbitGroup.visible = false;
        world.orbitGroup.visible = false;
      }
      if (!ui.wallpaper.active && now >= nextLabelsAt) {
        nextLabelsAt = now + 1000 / 33;
        camera.updateMatrixWorld();
        labels.update({ ...settings, ...visibleState,
          satellitesVisible: ui.wallpaper.satellitesVisible,
          labelsVisible: settings.labelsVisible && !earthsense.visible && !trajectoriesVisible,
        });
      }
      if (!ui.wallpaper.active && (now >= nextHudAt || navigating !== visibleState.flight)) {
        nextHudAt = now + 120;
        ui.updateHud();
        const detail = earthDetail.getState();
        if (!visibleState.flight && earthsense.visible) {
          document.getElementById('view-caption').textContent = detail.status === 'ready'
            ? `EARTHSENSE · ${detail.textureWidth / 1024}K 地表` : 'EARTHSENSE · 地表观测';
        } else if (!visibleState.flight && visibleState.focusBody === 'earth' && visibleState.stage === 'earth' && detail.status === 'ready') {
          document.getElementById('view-caption').textContent += ` · ${detail.textureWidth / 1024}K 地表`;
        }
      }
      if (ui.wallpaper.active) ui.wallpaper.update(dt);
      else {
        composer.render();
        updateEarthDetail(now, visibleState);
      }
    }
    addEventListener('resize', () => { resizePending = true; });
    function syncVisibility() {
      if (document.hidden || contextLost) {
        cancelAnimationFrame(frame);
        frame = 0;
        orbitGesture = false;
        return;
      }
      lastFrameTime = performance.now();
      lastInteraction = lastFrameTime;
      if (!frame) frame = requestAnimationFrame(animate);
    }
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
    window.RAINBOW_SEA = window.ORBIT = {
      version: '1.9.0',
      wallpaper: ui.wallpaper,
      getState: () => ({
        ...navigation.getState(), ...ui.getState(),
        planetCount: data.filter(d => d.orbit && d.id !== 'moon').length,
        satelliteCount: world.satellites.length,
        galaxyStars: world.galaxy.geometry.attributes.position.count,
        galaxyCount: world.galaxyDefinitions.length, deepSpaceBodyCount: world.deepSpace.bodies.size,
        flybys: world.flybys.getState(),
        trajectories: world.motionTrajectories.getState(),
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        mode: earthsense.active ? 'earthsense' : 'universe',
        earthDetail: earthDetail.getState(), pixelRatio: renderer.getPixelRatio(),
      }),
      goTo: navigation.flyTo, zoom: navigation.zoom, setPaused: ui.setPaused,
      setMode: earthsense.setMode,
      earthsense: { getState: earthsense.diagnostics, setLayer: earthsense.toggleLayer },
      trajectories: {
        getState: world.motionTrajectories.getState,
        setReferenceFrame: world.motionTrajectories.setReferenceFrame,
        setTrailLength: world.motionTrajectories.setTrailLength,
      },
      destinations: () => [...world.galaxyDefinitions, ...world.deepSpace.bodies.values()].map(body => ({
        id: body.id, name: body.cn, kind: body.kind, parentGalaxy: body.parentGalaxy,
        parentStarId: body.parentStarId, modelStatus: body.modelStatus,
      })),
    };
  } catch (error) {
    console.error(error);
    fail('无法初始化三维场景。请确认浏览器已开启硬件加速，或使用新版 Chrome、Edge、Safari 重试。');
  }
}
