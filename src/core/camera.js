// 彩虹海 modification: camera flight interpolation, input easing and timing.
import { TRAJECTORY_VIEW_DIRECTION } from '../universe/trajectory-catalog.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, smooth, mobile, reducedMotion } from './math.js';
import { snapshotCamera, restoreCamera, snapshotFlight, restoreFlight } from './camera-state.js';
import { earthSurfaceDirection } from './geographic-focus.js';

const MAX_DISTANCE = 3000000;
const ROTATION_DAMPING = .07;
const ZOOM_RESPONSE = 18;
const CLOSE_FRAMING_MARGIN = 1.15;

export function wheelZoomFactor(delta, mode, viewportHeight) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? viewportHeight : 1);
  return Math.exp(clamp(pixels, -400, 400) * .00135);
}

export function createCamera(renderer) {
  const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, .001, 4000000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = ROTATION_DAMPING;
  controls.enablePan = false;
  controls.zoomSpeed = 1.65;
  controls.rotateSpeed = .5;
  controls.minDistance = 1.13;
  controls.maxDistance = MAX_DISTANCE;
  controls.maxPolarAngle = Math.PI - .02;
  controls.minPolarAngle = .02;
  return { camera, controls };
}

/** Camera flight and scale tracking. Scene construction and DOM updates stay outside. */
export function createNavigation({ camera, controls, world, onInfo, onStage, toast, clock = () => performance.now() }) {
  const { bodies, earth, station, getData, getPosition } = world;
  const zero = new THREE.Vector3();
  const galaxyCenter = getPosition('galaxy');
  const temp = new THREE.Vector3(), collisionOffset = new THREE.Vector3();
  const flightRotation = new THREE.Quaternion(), flightStep = new THREE.Quaternion();
  const trackingBefore = new THREE.Vector3(), trackingAfter = new THREE.Vector3();
  let selected = 'earth', focusBody = 'earth', displayedId = 'earth';
  let activeGalaxyId = 'galaxy', activeSystemId = 'solar';
  let trajectoryView = false;
  let flight = null, returnFlight = null, lastMode = 'earth', lastAnnouncedView = 'earth';
  let zoomTarget = null;

  function destinationDistance(id) {
    const destination = getData(id);
    if (destination.kind === 'trajectory') return destination.viewDistance * (mobile() ? 1.7 : 1);
    if (destination.kind === 'group') {
      let distance = destination.viewDistance * (mobile() ? 1.65 : 1);
      const direction = new THREE.Vector3(.12, .8, 1.65).normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      for (const galaxy of world.galaxyDefinitions || []) {
        const relative = getPosition(galaxy.id).sub(getPosition(id));
        const radius = galaxy.radius * 1.15;
        const fit = relative.dot(direction) + Math.max(
          (Math.abs(relative.dot(right)) + radius) / (vertical * camera.aspect),
          (Math.abs(relative.dot(up)) + radius) / vertical);
        distance = Math.max(distance, fit * 1.04);
      }
      return distance;
    }
    if (destination.kind === 'galaxy') {
      if (!mobile()) return destination.viewDistance;
      const fit = destination.radius * 1.12
        / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
      return Math.max(destination.viewDistance * 1.25, fit);
    }
    if (id === 'galaxy') return 68000;
    if (id === 'solar') return 650;
    if (id === 'iss') return .88;
    if (id === 'jwst') return mobile() ? 5.3 : 4.1;
    const screenFit = mobile() ? (destination.parentGalaxy ? 1.7 : 1.19) : 1;
    if (destination.kind === 'spacecraft') {
      const fit = destination.r * 1.12
        / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
      return Math.max((destination.viewDistance || destination.r * 5.5) * screenFit, fit);
    }
    if (destination.kind === 'black-hole') {
      const radius = destination.visualRadius || destination.r * (destination.diskOuterRadius || 4.5);
      const fit = radius * 1.12 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
      return Math.max((destination.viewDistance || radius * 3.3) * screenFit, fit);
    }
    const distance = destination.r * (id === 'saturn' ? 8.6 : id === 'sun' || destination.kind === 'star' ? 5.5 : 4.65) * screenFit;
    if (!mobile()) return distance;
    const radius = destination.r * (id === 'saturn' ? 2.25 : 1.04);
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * .90;
    return Math.max(distance, radius * Math.hypot(1, 1 / halfWidth));
  }

  function destinationDirection(id, night = false) {
    const destination = getData(id);
    if (destination.kind === 'trajectory') return new THREE.Vector3(...TRAJECTORY_VIEW_DIRECTION).normalize();
    if (destination.kind === 'group') return new THREE.Vector3(.12, .8, 1.65).normalize();
    if (destination.kind === 'galaxy') {
      if (destination.profile === 'lenticular' || destination.profile === 'dust-lane') {
        return new THREE.Vector3(.16, .14, 1.7)
          .applyEuler(new THREE.Euler(...(destination.tilt || [0, 0, 0]))).normalize();
      }
      return new THREE.Vector3(.16, 1.3, 1.7).normalize();
    }
    if (destination.kind === 'spacecraft' && destination.viewDirection) {
      return new THREE.Vector3(...destination.viewDirection).normalize();
    }
    if (destination.kind === 'black-hole') {
      // A nearly edge-on approach reveals the thin foreground disk and the
      // upper/lower bands of bent light around the central shadow.
      return new THREE.Vector3(.45, .065, 1).applyEuler(
        new THREE.Euler(...(destination.diskTilt || [0.12, 0, -0.22])),
      ).normalize();
    }
    if (destination.parentStarId) {
      const towardStar = getPosition(destination.parentStarId).sub(getPosition(id)).normalize();
      const tangent = new THREE.Vector3().crossVectors(towardStar, new THREE.Vector3(0, 1, 0));
      return towardStar.addScaledVector(tangent, .5).add(new THREE.Vector3(0, .42, 0)).normalize();
    }
    if (destination.parentGalaxy) return new THREE.Vector3(.45, .38, 1).normalize();
    if (id === 'galaxy') return new THREE.Vector3(.14, 1.2, 1.55).normalize();
    if (id === 'solar') return new THREE.Vector3(.18, 1.15, 1.45).normalize();
    if (id === 'jwst') return new THREE.Vector3(.85, .72, 1.65).applyQuaternion(world.jwst.body.group.quaternion).normalize();
    if (id === 'iss') {
      const outward = station.position.clone().sub(earth.position).normalize();
      const tangent = new THREE.Vector3().crossVectors(outward, new THREE.Vector3(0, 1, 0)).normalize();
      return outward.addScaledVector(tangent, .35).add(new THREE.Vector3(0, .15, 0)).normalize();
    }
    const position = getPosition(id);
    if (id === 'earth') return night
      ? position.normalize().multiplyScalar(1.1).add(new THREE.Vector3(0, .14, .3)).normalize()
      : new THREE.Vector3(2.1, .95, 3.8).normalize();
    return position.normalize().negate().multiplyScalar(.9).add(new THREE.Vector3(.3, .48, 1.15)).normalize();
  }

  function updateInfo(id) {
    displayedId = id;
    onInfo(id);
  }

  function flyTo(id, { night = false, immediate = false, earthFocus = null, distance } = {}) {
    const destination = getData(id);
    if (!destination) return;
    returnFlight = null;
    zoomTarget = null;
    selected = id;
    trajectoryView = destination.kind === 'trajectory';
    if (trajectoryView) {
      focusBody = 'earth';
      activeGalaxyId = 'galaxy';
      activeSystemId = 'solar';
    } else if (id === 'galaxy' || id === 'solar') {
      if (activeGalaxyId !== 'galaxy' || activeSystemId !== 'solar') focusBody = 'earth';
      activeGalaxyId = 'galaxy';
      activeSystemId = 'solar';
    } else if (destination.kind === 'galaxy') {
      activeGalaxyId = id;
      const firstStar = [...bodies.values()].find(body => body.parentGalaxy === id && body.kind === 'star');
      const firstBody = firstStar || [...bodies.values()].find(body => body.parentGalaxy === id);
      // Galaxies without individually catalogued stars still own their focus.
      // Otherwise zooming in would drift back to the previously visited system.
      focusBody = activeSystemId = firstBody?.id || id;
    } else if (bodies.has(id) || id === 'iss') {
      focusBody = id;
      activeGalaxyId = destination.parentGalaxy || 'galaxy';
      activeSystemId = destination.parentSystemId || destination.parentStarId
        || (destination.kind === 'star' || destination.kind === 'black-hole' ? id : 'solar');
    }
    updateInfo(id);
    // Destination limits apply after arrival; applying them now would clamp the
    // starting view (for example Earth at 4.65 → trajectories at minimum 60).
    controls.minDistance = .001;
    controls.maxDistance = MAX_DISTANCE;
    // Stop drag inertia without moving the visible starting camera.
    if (controls.enableDamping) restoreCamera(camera, controls, snapshotCamera(camera, controls));
    const startOffset = camera.position.clone().sub(controls.target);
    flight = {
      id, night, start: clock(), duration: immediate || reducedMotion ? 1
        : id === 'galaxy' ? 2600 : destination.kind === 'group' || destination.kind === 'galaxy' ? 3200 : 1350,
      startTarget: controls.target.clone(), startDir: startOffset.clone().normalize(),
      startDist: Math.max(.001, startOffset.length()),
      endDist: Number.isFinite(distance) && distance > 0 ? clamp(distance, .001, MAX_DISTANCE) : destinationDistance(id),
      endDir: earthFocus ? earthSurfaceDirection(earth, earthFocus) : destinationDirection(id, night), earthFocus,
    };
    controls.enabled = false;
    controls.update();
    toast(night ? '正在飞向地球夜侧' : id === 'iss' ? '正在接近国际空间站' : '');
  }

  function keepOutsideBodies() {
    let corrected = false;
    for (const body of bodies.values()) {
      collisionOffset.copy(camera.position).sub(body.position);
      const min = body.r * 1.018;
      if (collisionOffset.lengthSq() < min * min) {
        if (collisionOffset.lengthSq() < .000001) collisionOffset.set(0, 0, 1);
        camera.position.copy(body.position).add(collisionOffset.setLength(min));
        corrected = true;
      }
    }
    if (corrected) camera.lookAt(controls.target);
  }

  function flightDirection(from, to, progress) {
    // A linear blend collapses at opposite directions, causing a visible flip.
    flightRotation.setFromUnitVectors(from, to);
    flightStep.identity().slerp(flightRotation, progress);
    return temp.copy(from).applyQuaternion(flightStep);
  }

  function updateFlight(now) {
    const current = flight;
    if (!current) return;
    const t = reducedMotion ? 1 : clamp((now - current.start) / current.duration, 0, 1);
    const eased = t * t * (3 - 2 * t);
    controls.target.lerpVectors(current.startTarget, getPosition(current.id), eased);
    current.endDir.copy(current.earthFocus ? earthSurfaceDirection(earth, current.earthFocus) : destinationDirection(current.id, current.night));
    const direction = flightDirection(current.startDir, current.endDir, eased);
    const distance = Math.exp(THREE.MathUtils.lerp(Math.log(current.startDist), Math.log(current.endDist), eased));
    camera.position.copy(controls.target).addScaledVector(direction, distance);
    keepOutsideBodies();
    controls.update();
    if (t >= 1) cancelFlight();
  }

  function updateReturnFlight(now) {
    const current = returnFlight;
    const t = reducedMotion ? 1 : clamp((now - current.start) / current.duration, 0, 1);
    const eased = t * t * (3 - 2 * t);
    controls.target.lerpVectors(current.startTarget, current.endTarget, eased);
    const direction = flightDirection(current.startDir, current.endDir, eased);
    const distance = Math.exp(THREE.MathUtils.lerp(Math.log(current.startDist), Math.log(current.endDist), eased));
    camera.position.copy(controls.target).addScaledVector(direction, distance);
    const zoom = THREE.MathUtils.lerp(current.startZoom, current.saved.camera.zoom, eased);
    if (zoom !== camera.zoom) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
    controls.update();
    keepOutsideBodies();
    if (t >= 1) restore(current.saved);
  }

  function groupTransitionStart() {
    // A portrait panorama needs more camera distance. Keep its full galaxy
    // framed before starting the next transition out to the Local Group.
    return Math.max(150000, mobile() ? destinationDistance(activeGalaxyId) * 1.2 : 0);
  }

  function compactCloseDistance(body) {
    if (!mobile() || body.kind === 'galaxy') return 0;
    // A complete portrait view of a wide body, such as Saturn with its rings,
    // can require a longer camera distance than the desktop close-view range.
    return destinationDistance(focusBody) * CLOSE_FRAMING_MARGIN;
  }

  function trackingCenter(distance, out = new THREE.Vector3()) {
    if (trajectoryView) return out.copy(getPosition('trajectory', out));
    const body = getData(focusBody), target = out.copy(getPosition(focusBody, out));
    const closeView = body.kind === 'spacecraft' ? destinationDistance(focusBody) * 1.25 : compactCloseDistance(body);
    const leave = smooth(Math.max(body.r * 9, 8, closeView), Math.max(body.r * 25, 75, closeView * 2), distance);
    target.lerp(activeSystemId === 'solar' ? zero : getPosition(activeSystemId), leave);
    const galaxyBlendEnd = Math.min(30000, (getData(activeGalaxyId).viewDistance || 68000) * .7);
    target.lerp(activeGalaxyId === 'galaxy' ? galaxyCenter : getPosition(activeGalaxyId), smooth(1800, galaxyBlendEnd, distance));
    if (getData('local-group')) {
      const start = groupTransitionStart();
      target.lerp(getPosition('local-group'), smooth(start, Math.max(500000, start * 2.4), distance));
    }
    return target;
  }

  function updateTracking(dt) {
    const distance = camera.position.distanceTo(controls.target), body = getData(focusBody);
    temp.copy(trackingCenter(distance, trackingAfter)).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 8));
    controls.target.add(temp);
    camera.position.add(temp);
    controls.minDistance = trajectoryView ? 60 : focusBody === 'iss' ? .20
      : body.r * (body.kind === 'black-hole' ? 2.8 : 1.13);
    controls.maxDistance = trajectoryView ? 2400 : MAX_DISTANCE;
    controls.dampingFactor = reducedMotion ? 1 : 1 - (1 - ROTATION_DAMPING) ** (dt * 60);
    advanceZoom(dt);
    controls.update();
    keepOutsideBodies();
  }

  function cancelFlight() {
    if (flight || returnFlight) toast('');
    flight = null;
    returnFlight = null;
    controls.enabled = true;
    const body = getData(focusBody);
    controls.minDistance = trajectoryView ? 60 : focusBody === 'iss' ? .20
      : body.r * (body.kind === 'black-hole' ? 2.8 : 1.13);
    controls.maxDistance = trajectoryView ? 2400 : MAX_DISTANCE;
  }

  function setZoomDistance(distance) {
    camera.position.sub(controls.target).setLength(distance).add(controls.target);
  }

  function zoom(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    if (flight || returnFlight) cancelFlight();
    zoomTarget = null;
    setZoomDistance(clamp(camera.position.distanceTo(controls.target) * factor, controls.minDistance, controls.maxDistance));
    controls.update();
  }

  function zoomBy(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    if (reducedMotion) return zoom(factor);
    if (flight || returnFlight) cancelFlight();
    const base = zoomTarget ?? camera.position.distanceTo(controls.target);
    zoomTarget = clamp(base * factor, controls.minDistance, controls.maxDistance);
  }

  function advanceZoom(dt) {
    if (zoomTarget === null) return;
    const from = Math.log(Math.max(.001, camera.position.distanceTo(controls.target)));
    const to = Math.log(zoomTarget);
    const next = THREE.MathUtils.lerp(from, to, 1 - Math.exp(-ZOOM_RESPONSE * dt));
    if (reducedMotion || Math.abs(to - next) < .001) {
      setZoomDistance(zoomTarget);
      zoomTarget = null;
    } else {
      setZoomDistance(Math.exp(next));
    }
  }

  function stage() {
    if (trajectoryView) return 'trajectory';
    const distance = camera.position.distanceTo(controls.target);
    if (getData('local-group') && distance > groupTransitionStart() * 4 / 3) return 'local-group';
    const focus = getData(focusBody);
    if (focus.kind === 'galaxy') return 'galaxy';
    if (focus.kind === 'black-hole') return distance > 2600 ? 'galaxy' : 'earth';
    const closeLimit = Math.max(28, focus.r * 10, compactCloseDistance(focus));
    return distance > 2600 ? 'galaxy' : distance > closeLimit ? 'solar' : 'earth';
  }

  function updateStage() {
    const mode = stage();
    if (mode !== lastMode) {
      lastMode = mode;
      onStage(mode);
    }
    if (!flight && !returnFlight) {
      const view = mode === 'galaxy' ? activeGalaxyId : mode;
      if (view !== lastAnnouncedView) {
        lastAnnouncedView = view;
        if (mode === 'galaxy') toast(`进入${getData(activeGalaxyId).cn} · 继续缩小可打开星系图鉴`);
        else if (mode === 'local-group') toast('打开星系图鉴 · 点击星系继续远行');
        else toast('');
      }
      const infoId = mode === 'trajectory' ? 'trajectory' : mode === 'earth' ? focusBody : mode === 'solar' ? activeSystemId
        : mode === 'galaxy' ? activeGalaxyId : 'local-group';
      if (displayedId !== infoId) updateInfo(infoId);
      selected = infoId;
    }
  }

  function update(dt, now, updateBodies) {
    // Follow orbital motion exactly, including at 20×; smooth only exploration scale changes.
    const distance = camera.position.distanceTo(controls.target);
    const before = flight || returnFlight ? null : trackingCenter(distance, trackingBefore);
    updateBodies(dt);
    if (returnFlight) updateReturnFlight(now);
    else if (flight) updateFlight(now);
    else {
      const motion = trackingCenter(distance, trackingAfter).sub(before);
      controls.target.add(motion);
      camera.position.add(motion);
      updateTracking(dt);
    }
  }

  function initialize() {
    controls.target.copy(earth.position);
    camera.position.copy(earth.position).addScaledVector(destinationDirection('earth'), destinationDistance('earth'));
    controls.update();
  }

  function focusEarth({ lat, lon, distance = 2.0 }) {
    if (![lat, lon, distance].every(Number.isFinite)) return false;
    flyTo('earth', { earthFocus: { lat: clamp(lat, -90, 90), lon }, distance: clamp(distance, 1.13, 28) });
    return true;
  }

  function snapshot() {
    // A second mode switch during the return still preserves the original trip.
    if (returnFlight) return returnFlight.saved;
    return {
      selected, focusBody, displayedId, lastMode,
      activeGalaxyId, activeSystemId, trajectoryView,
      camera: snapshotCamera(camera, controls), flight: snapshotFlight(flight, clock()),
    };
  }

  function restore(saved, { animate = false } = {}) {
    const startCamera = animate && !reducedMotion ? snapshotCamera(camera, controls) : null;
    selected = saved.selected;
    focusBody = saved.focusBody;
    displayedId = saved.displayedId;
    lastMode = saved.lastMode;
    activeGalaxyId = saved.activeGalaxyId || 'galaxy';
    activeSystemId = saved.activeSystemId || 'solar';
    trajectoryView = saved.trajectoryView || false;
    flight = null;
    returnFlight = null;
    zoomTarget = null;
    toast('');
    if (startCamera) {
      const startTarget = new THREE.Vector3().fromArray(startCamera.target);
      const endTarget = new THREE.Vector3().fromArray(saved.camera.target);
      const startOffset = new THREE.Vector3().fromArray(startCamera.position).sub(startTarget);
      const endOffset = new THREE.Vector3().fromArray(saved.camera.position).sub(endTarget);
      // Drain drag damping without changing the view visible at the mode click.
      restoreCamera(camera, controls, startCamera);
      returnFlight = { saved, start: clock(),
        duration: startTarget.distanceTo(endTarget) > 10000 || Math.max(startOffset.length(), endOffset.length()) > 2600 ? 2200 : 1000,
        startTarget, endTarget, startDir: startOffset.clone().normalize(), endDir: endOffset.clone().normalize(),
        startDist: Math.max(.001, startOffset.length()), endDist: Math.max(.001, endOffset.length()),
        startZoom: startCamera.zoom,
      };
      controls.minDistance = .001;
      controls.maxDistance = MAX_DISTANCE;
      controls.enabled = false;
    } else {
      flight = restoreFlight(saved.flight, clock());
      restoreCamera(camera, controls, saved.camera);
    }
    onInfo(displayedId);
    onStage(lastMode);
  }

  controls.addEventListener?.('start', () => { zoomTarget = null; });
  return {
    initialize, flyTo, zoom, zoomBy, cancelFlight, trackingCenter, stage, update, updateStage, focusEarth, snapshot, restore,
    getState: () => ({ selected, focusBody, displayedId, activeGalaxyId, activeSystemId, trajectoryView,
      flight: !!flight || !!returnFlight, returning: !!returnFlight,
      stage: stage(), distance: camera.position.distanceTo(controls.target),
      galaxyViewDistance: destinationDistance(activeGalaxyId) }),
  };
}
