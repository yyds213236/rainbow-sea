// Modified for 彩虹海: focus-safe shortcuts, stage state and eased zoom controls.
import { bindWallpaperMode } from './wallpaper.js';
import { reducedMotion } from '../core/math.js';
import { bindBodyPicking } from './picking.js';
import { createDestinations } from './destinations.js';
import { createTrajectoryPanel } from './trajectory-panel.js';

export function bindNavigationUI({ renderer, camera, world, navigation, assets, toast, onPick, controls, wallpaperView, setSpaceColor }) {
  const $ = id => document.getElementById(id);
  const { flyTo, zoomBy: zoom } = navigation;
  const stageButtons = [...document.querySelectorAll('[data-view]')];
  const sceneButtons = stageButtons.filter(button => button.closest('.scenes'));
  const scaleButtons = stageButtons.filter(button => !button.closest('.scenes'));
  const speedSelect = $('speed');
  const fullscreenButton = $('fullscreen');
  let activeScene, activeScale;
  let paused = reducedMotion, speed = 1, orbitsVisible = true, labelsVisible = true;
  let destinations, trajectoryPanel;

  function setPaused(value) {
    paused = value;
    $('pause').innerHTML = paused
      ? '<svg viewBox="0 0 24 24"><path d="m9 5 10 7-10 7Z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';
    $('pause').setAttribute('aria-label', paused ? '继续天体运动' : '暂停天体运动');
    $('pause').title = paused ? '继续（空格）' : '暂停（空格）';
  }

  function setCurrentView(buttons, view) {
    for (const button of buttons) {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }

  function updateStage(mode, state = navigation.getState()) {
    const { activeGalaxyId, activeSystemId, focusBody } = state;
    const scale = mode === 'local-group' || (activeGalaxyId === 'galaxy' && (mode === 'galaxy' || activeSystemId === 'solar'))
      ? mode : null;
    // A close view of another planet is still part of the Solar System tab.
    const scene = scale === 'earth' && !['earth', 'iss'].includes(focusBody) ? 'solar' : scale;
    if (scene !== activeScene) {
      activeScene = scene;
      setCurrentView(sceneButtons, scene);
    }
    if (scale !== activeScale) {
      activeScale = scale;
      setCurrentView(scaleButtons, scale);
    }
    destinations?.update(state);
    trajectoryPanel?.update();
    $('toggle-trajectories').setAttribute('aria-pressed', String(mode === 'trajectory'));
  }

  function restoreState(settings) {
    setPaused(settings.paused);
    speed = settings.speed;
    labelsVisible = settings.labelsVisible;
    speedSelect.value = String(speed);
    $('toggle-orbits').setAttribute('aria-pressed', String(orbitsVisible));
    $('toggle-labels').setAttribute('aria-pressed', String(labelsVisible));
  }

  function updateHud() {
    const deployment = world.jwst.getState();
    $('jwst-deploy').textContent = deployment.targetExpanded ? '收拢模型 ↙' : '展开模型 ↗';
    $('jwst-deploy').setAttribute('aria-pressed', String(deployment.targetExpanded));
    $('jwst-deployment-status').textContent = deployment.animating
      ? `${deployment.targetExpanded ? '正在展开' : '正在收拢'} · ${deployment.phase} · 部署动画为压缩示意`
      : deployment.progress === 1 ? '十八片曲面镜 · 五层薄膜 · 收拢仅作部署演示' : '模型已收拢 · 简化部署回放，非在轨操作';

    const state = navigation.getState();
    const { stage, focusBody, activeGalaxyId, activeSystemId } = state;
    updateStage(stage, state);
    if (state.flight) {
      $('view-caption').textContent = state.returning ? '正在返回此前视角' : `正在飞往${world.getData(state.selected).cn}`;
      $('view-distance').textContent = '';
    } else if (stage === 'trajectory') {
      $('view-caption').textContent = '太阳系运动轨迹';
      $('view-distance').textContent = world.motionTrajectories.getState().referenceFrame === 'solar'
        ? '太阳参照 · 观察行星公转' : '银河参照 · 观察前进与公转';
    } else if (stage === 'local-group') {
      $('view-caption').textContent = world.getData('local-group').cn;
      $('view-distance').textContent = `${world.galaxyDefinitions.length} 座星系 · 点击开始星际航行`;
    } else if (stage === 'galaxy') {
      $('view-caption').textContent = world.getData(activeGalaxyId).cn + '全景';
      $('view-distance').textContent = '探索天体 · 继续缩小打开星系图鉴';
    } else if (stage === 'solar') {
      const hasPlanets = [...world.bodies.values()].some(body => body.parentStarId === activeSystemId);
      $('view-caption').textContent = activeSystemId === 'solar' ? '太阳系全景'
        : world.getData(activeSystemId).cn + (hasPlanets ? '系统' : '周边');
      $('view-distance').textContent = activeSystemId === 'solar' ? '八大行星运行轨道'
        : hasPlanets ? '母星与行星 · 轨道为示意' : '恒星周边 · 继续缩小前往星系';
    } else {
      const body = world.getData(focusBody);
      $('view-caption').textContent = focusBody === 'earth' ? '地球近轨' : body.cn + (focusBody === 'iss' ? '近景' : '观测');
      if (focusBody === 'jwst') {
        $('view-distance').textContent = '日地 L2 附近 · 姿态、轨道与比例示意';
        return;
      }
      if (body.kind === 'spacecraft') {
        $('view-distance').textContent = '星际空间探测器 · 位置与航迹示意';
        return;
      }
      if (body.parentGalaxy) {
        $('view-distance').textContent = body.kind === 'black-hole' ? '黑洞阴影与吸积盘 · 艺术示意'
          : body.kind === 'star' ? '恒星表面与日冕示意'
          : body.modelStatus === 'illustration' ? '创作示意 · 未确认存在' : '已确认行星 · 表面示意';
        return;
      }
      const surface = Math.max(0, camera.position.distanceTo(world.getPosition(focusBody)) - (body.r || 1));
      const kilometers = Math.round(surface / Math.max(.001, body.r) * Number((body.diameter || '12742').replaceAll(',', '')) / 2);
      $('view-distance').textContent = focusBody === 'iss' ? '地球低轨道' : `距表面约 ${kilometers.toLocaleString('zh-CN')} km`;
    }
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('此浏览器暂不支持全屏，可使用浏览器的全屏模式');
    } catch {
      toast('全屏未开启，可使用浏览器的全屏模式');
    }
  }

  function syncFullscreen() {
    const active = Boolean(document.fullscreenElement);
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.title = active ? '退出全屏（F）' : '全屏（F）';
  }

  destinations = createDestinations({ world, navigation, assets });
  trajectoryPanel = createTrajectoryPanel({ world, navigation });
  $('toggle-trajectories').onclick = () => flyTo(navigation.getState().stage === 'trajectory' ? 'solar' : 'trajectory');
  stageButtons.forEach(button => button.onclick = () => flyTo(button.dataset.view));
  $('home').onclick = event => { event.preventDefault(); flyTo('earth'); };
  $('night-view').onclick = () => flyTo('earth', { night: true });
  $('station-view').onclick = () => flyTo('iss');
  $('jwst-visit').onclick = () => flyTo('jwst');
  $('jwst-deploy').onclick = () => world.jwst.setDeployment(!world.jwst.getState().targetExpanded, { immediate: reducedMotion });
  $('zoom-in').onclick = () => zoom(.72);
  $('zoom-out').onclick = () => zoom(1.45);
  $('pause').onclick = () => setPaused(!paused);
  speedSelect.onchange = () => {
    speed = Number(speedSelect.value);
    toast('演示时间流速 ' + speed + '×');
  };
  function setOrbitsVisible(value) {
    orbitsVisible = value;
    $('toggle-orbits').setAttribute('aria-pressed', String(orbitsVisible));
  }
  $('toggle-orbits').onclick = () => wallpaper.configure({orbitsVisible:!orbitsVisible});
  $('toggle-labels').onclick = () => {
    labelsVisible = !labelsVisible;
    $('toggle-labels').setAttribute('aria-pressed', String(labelsVisible));
  };
  const wallpaper = bindWallpaperMode(renderer.domElement, { world, controls, navigation, view: wallpaperView, setSpaceColor, setOrbitsVisible });
  fullscreenButton.onclick = fullscreen;
  document.addEventListener('fullscreenchange', syncFullscreen);
  syncFullscreen();
  $('help-button').onclick = () => $('help-dialog').showModal();
  $('credits-button').onclick = () => $('credits-dialog').showModal();
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(dialog => dialog.onclick = event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
  addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.keyCode === 229) return;
    if (document.querySelector('dialog[open]')) return;
    const tag = event.target.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.target.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (event.repeat && !['+', '=', '-'].includes(key)) return;
    if (wallpaper.active) {
      if (key === 'i' || key === 'escape') wallpaper.exit();
      if (['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(event.key)) { event.preventDefault(); wallpaper.next(['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1); }
      return;
    }
    if (['BUTTON', 'A', 'SUMMARY'].includes(tag) && event.code === 'Space') return;
    if (event.code === 'Space') { event.preventDefault(); setPaused(!paused); }
    if (key === '+' || key === '=') zoom(.8);
    if (key === '-') zoom(1.25);
    if (key === 'h') flyTo('earth');
    if (key === 'f') fullscreen();
    if (key === 'i') wallpaper.toggle();
    if (key === '?') $('help-dialog').showModal();
  });
  bindBodyPicking({ renderer, camera, world, navigation, onPick, isEnabled: () => !wallpaper.active });
  setPaused(paused);
  updateStage(navigation.stage());

  return { wallpaper, getState: () => ({ paused, speed, orbitsVisible, labelsVisible }), setPaused, restoreState, updateStage, updateHud };
}
