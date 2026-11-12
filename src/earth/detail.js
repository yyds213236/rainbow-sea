// 彩虹海 modification: defer expensive detail resources until an idle frame.
import * as THREE from 'three';
import { detailTextureWidth, loadDetailTextures } from './detail-textures.js';

/** Both modes share the same detailed Earth and its original day/night lighting. */
export function createEarthDetail({ world, renderer, assets, compact = false,
  deviceMemory = globalThis.navigator?.deviceMemory ?? 8, load = loadDetailTextures, beforeUpload }) {
  const { earth, clouds } = world;
  const material = earth.mesh.material, atmosphere = earth.atmosphere;
  const original = {
    day: material.uniforms.uDay.value, night: material.uniforms.uNight.value,
    geometry: earth.mesh.geometry, cloudGeometry: clouds.geometry,
    cloudVisible: clouds.visible,
    atmosphereGeometry: atmosphere?.geometry,
  };
  const width = detailTextureWidth({ maxTextureSize: renderer.capabilities.maxTextureSize, compact, deviceMemory });
  let observation = false, disposed = false, detail, geometry, pending, status = 'idle', error = '';
  let controller;

  function apply() {
    material.uniforms.uDay.value = detail ? detail.day : original.day;
    material.uniforms.uNight.value = detail ? detail.night : original.night;
    earth.mesh.geometry = geometry || original.geometry;
    clouds.geometry = geometry || original.cloudGeometry;
    // The fixed decorative cloud map cannot represent clear sampled weather.
    clouds.visible = original.cloudVisible && !observation;
    if (atmosphere) atmosphere.geometry = geometry || original.atmosphereGeometry;
  }

  function prepare() {
    if (disposed || pending || detail) return pending;
    if (width <= 2048) { status = 'fallback'; return; }
    status = 'loading';
    error = '';
    controller = new AbortController();
    pending = load(assets, renderer, width, { beforeUpload, signal: controller.signal }).then(result => {
      if (disposed) { result.day.dispose(); result.night.dispose(); return; }
      detail = result;
      geometry = new THREE.SphereGeometry(1, 256, 160);
      status = 'ready';
      // A mode change never downgrades or relights the already loaded Earth.
      apply();
    }).catch(reason => {
      if (disposed) return;
      status = reason?.name === 'AbortError' ? 'idle' : 'fallback';
      error = reason?.message || '';
    }).finally(() => { pending = null; controller = null; });
    return pending;
  }

  function setObservation(value) {
    if (disposed || observation === value) return;
    observation = value;
    apply();
  }

  return {
    prepare, setObservation,
    get status() { return status; },
    ready: () => pending ?? Promise.resolve(),
    getState: () => ({ shared: true, observation, status, textureWidth: detail ? detail.width : 2048,
      decorativeCloudsVisible: clouds.visible, error }),
    dispose() {
      if (disposed) return;
      disposed = true;
      controller?.abort();
      observation = false;
      geometry?.dispose();
      detail?.day.dispose(); detail?.night.dispose();
      geometry = null; detail = null;
      apply();
    },
  };
}
