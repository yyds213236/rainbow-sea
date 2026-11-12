// Modified for 彩虹海: full-catalog search and keyboard navigation.
import { data } from '../universe/catalog.js';

const aliases = {
  iss: ['国际空间站', 'International Space Station'],
  jwst: ['韦布望远镜', 'James Webb Space Telescope'],
  'sagittarius-a': ['银河系中心黑洞', '银河中心黑洞'],
};

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\-‐‑–—·'’]/g, '');

function matchRank(body, needle) {
  const terms = [body.cn, body.en, body.id, body.index, ...(aliases[body.id] || [])].map(normalize);
  if (terms.includes(needle)) return 0;
  if (terms.some(term => term.startsWith(needle))) return 1;
  return terms.some(term => term.includes(needle)) ? 2 : Infinity;
}

/** Match common name and catalog-number formatting without changing the list. */
export function filterDestinations(items, query = '') {
  const needle = normalize(query);
  return needle ? items.filter(body => Number.isFinite(matchRank(body, needle))) : items;
}

export function searchDestinations(items, query) {
  const needle = normalize(query);
  if (!needle) return [];
  return items.map(body => ({ body, rank: matchRank(body, needle) }))
    .filter(item => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank)
    .map(({ body }) => body);
}

export function destinationSearchIndex(world) {
  const ids = new Set([...data.map(body => body.id), 'jwst', 'voyager-1', 'iss', 'solar', 'local-group', 'trajectory',
    ...world.galaxyDefinitions.map(body => body.id), ...world.bodies.keys()]);
  return Array.from(ids, id => world.getData(id)).filter(Boolean);
}

/** Choose the destinations appropriate to the current exploration hierarchy. */
export function destinationContext(state, world) {
  const selected = world.getData(state.selected);
  if (state.stage === 'local-group' || (state.flight && selected?.kind === 'group')) {
    return { key: 'local-group', title: world.getData('local-group').cn, items: world.galaxyDefinitions,
      overviewId: 'galaxy', overviewLabel: '回银河系' };
  }
  if (state.activeGalaxyId !== 'galaxy') {
    const galaxy = world.getData(state.activeGalaxyId);
    const members = [...world.bodies.values()].filter(body => body.parentGalaxy === state.activeGalaxyId);
    return { key: state.activeGalaxyId, title: world.getData(state.activeGalaxyId).cn,
      items: members.length ? members : [galaxy],
      overviewId: state.activeGalaxyId, overviewLabel: '星系全景' };
  }
  if (state.stage === 'galaxy' || state.activeSystemId !== 'solar') {
    const members = [...world.bodies.values()].filter(body => body.parentGalaxy === 'galaxy');
    return { key: 'galaxy', title: '银河目的地',
      items: [world.getData('solar'), ...members.filter(body => body.kind === 'spacecraft'),
        ...members.filter(body => body.kind === 'planet'),
        ...members.filter(body => body.kind !== 'spacecraft' && body.kind !== 'planet')],
      overviewId: 'galaxy', overviewLabel: '银河全景' };
  }
  return { key: 'solar', title: '太阳系', items: [...data, world.getData('jwst'), world.getData('voyager-1')].filter(Boolean), overviewId: 'solar', overviewLabel: '全景' };
}

function thumbnail(body, assets) {
  if (body.texture && assets[body.texture]) {
    const image = document.createElement('img');
    image.src = assets[body.texture];
    image.alt = '';
    image.decoding = 'async';
    return image;
  }
  const image = document.createElement('span');
  const kind = body.kind === 'observatory' || body.id === 'iss' ? 'spacecraft' : body.kind;
  image.className = 'destination-art ' + (kind || (body.id === 'solar' ? 'star' : 'galaxy'));
  if (body.surfaceStyle) image.classList.add(body.surfaceStyle);
  if (body.kind === 'galaxy' && body.profile) image.classList.add(body.profile);
  image.setAttribute('aria-hidden', 'true');
  image.style.setProperty('--body-color', '#' + (body.color ?? 0x9fd9ee).toString(16).padStart(6, '0'));
  if (body.shape === 'irregular' || body.shape === 'elliptical') image.classList.add(body.shape);
  return image;
}

export function createDestinations({ world, navigation, assets }) {
  const $ = id => document.getElementById(id);
  const search = $('destination-search');
  const list = $('planet-list');
  const dock = list.closest('.planet-dock');
  const heading = $('dock-context');
  const status = $('destination-search-status');
  const clear = $('destination-search-clear');
  const overview = $('overview');
  const overviewLabel = overview.querySelector('span');
  const galaxyReturn = $('galaxy-return');
  const systemOverview = $('system-overview');
  const deepActions = $('deep-space-actions');
  const catalog = destinationSearchIndex(world);
  let context, contextSignature, renderedQuery, selectedId;
  let buttons = [];
  let composing = false;

  search.setAttribute('aria-controls', list.id);
  search.addEventListener('compositionstart', () => { composing = true; });
  search.addEventListener('compositionend', () => { composing = false; update(); });
  search.addEventListener('input', event => { if (!composing && !event.isComposing) update(); });
  if (clear) clear.onclick = clearSearch;

  overview.onclick = () => travel(context.overviewId);
  galaxyReturn.onclick = () => travel(navigation.getState().activeGalaxyId);
  $('group-return').onclick = () => travel('local-group');
  systemOverview.onclick = () => {
    const { activeSystemId } = navigation.getState();
    if (activeSystemId === 'solar') return travel('solar');
    const host = world.getData(activeSystemId);
    if (host?.kind !== 'star') return;
    const orbits = [...world.bodies.values()].filter(body => body.parentStarId === activeSystemId);
    const extent = Math.max(host.r * 9, ...orbits.map(body => body.orbitRadius + body.r));
    travel(activeSystemId, { distance: extent * 3.3 });
  };

  function clearSearch() {
    search.focus({ preventScroll: true });
    search.value = '';
    update();
  }

  function travel(id, options) {
    navigation.flyTo(id, options);
    search.value = '';
    update();
  }

  function reveal(button) {
    if (!button || !list.clientWidth) return;
    const viewport = list.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    if (target.left < viewport.left) list.scrollLeft += target.left - viewport.left;
    else if (target.right > viewport.right) list.scrollLeft += target.right - viewport.right;
  }

  function focusResult(index) {
    const button = buttons[index];
    if (!button) return;
    button.focus({ preventScroll: true });
    reveal(button);
  }

  search.addEventListener('keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && search.value) {
      event.preventDefault();
      clearSearch();
    } else if (event.key === 'Enter' && renderedQuery) {
      event.preventDefault();
      if (!event.repeat) buttons[0]?.click();
    } else if (buttons.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      focusResult(event.key === 'ArrowDown' ? 0 : buttons.length - 1);
    }
  });

  list.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    const last = buttons.length - 1;
    if (event.key === 'ArrowLeft') focusResult(Math.max(0, index - 1));
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') focusResult(Math.min(last, index + 1));
    else if (event.key === 'Home') focusResult(0);
    else if (event.key === 'End') focusResult(last);
    else if (event.key === 'ArrowUp') {
      if (index > 0) focusResult(index - 1);
      else search.focus({ preventScroll: true });
    } else if (event.key === 'Escape' && renderedQuery) clearSearch();
    else return;
    event.preventDefault();
  });

  function renderItems(query, state) {
    const previousFocus = list.contains(document.activeElement) ? document.activeElement : null;
    const items = query ? searchDestinations(catalog, query) : context.items;
    buttons = items.map(body => {
      const button = document.createElement('button');
      button.className = 'planet-button';
      button.type = 'button';
      button.dataset.id = body.id;
      button.title = '前往' + body.cn;
      const name = document.createElement('span');
      name.className = 'destination-name';
      name.textContent = body.id === 'jwst' ? '韦布 JWST' : body.cn;
      button.append(thumbnail(body, assets), name);
      if (body.modelStatus === 'illustration' || body.modelStatus === 'candidate') {
        const badge = document.createElement('small');
        badge.className = 'destination-status';
        badge.textContent = body.modelStatus === 'illustration' ? '示意' : '候选';
        button.append(badge);
      }
      button.onclick = () => travel(body.id);
      return button;
    });
    if (buttons.length) list.replaceChildren(...buttons);
    else {
      const empty = document.createElement('p');
      empty.className = 'destination-empty';
      empty.textContent = '没有匹配的天体，试试名称或编号';
      if (query) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'destination-empty-reset';
        reset.textContent = '清空搜索';
        reset.onclick = clearSearch;
        empty.append(' ', reset);
      }
      list.replaceChildren(empty);
    }
    list.scrollLeft = 0;
    dock.classList.toggle('searching-dock', Boolean(query));
    dock.classList.toggle('deep-space-dock', Boolean(query) || context.key !== 'solar');
    heading.textContent = query ? '搜索结果' : context.title;
    if (status && renderedQuery !== query) {
      status.textContent = query ? items.length ? `找到 ${items.length} 个目的地` : '未找到匹配的天体'
        : renderedQuery ? '已清空搜索' : '';
    }
    renderedQuery = query;
    setSelected(state.selected);
    if (previousFocus) {
      const restored = buttons.find(button => button.dataset.id === previousFocus.dataset.id);
      if (restored) {
        restored.focus({ preventScroll: true });
        reveal(restored);
      } else search.focus({ preventScroll: true });
    }
  }

  function setSelected(id) {
    selectedId = id;
    for (const button of buttons) {
      const active = button.dataset.id === id;
      button.classList.toggle('active', active);
      if (active) {
        button.setAttribute('aria-current', 'true');
        if (!renderedQuery && !list.contains(document.activeElement)) reveal(button);
      } else button.removeAttribute('aria-current');
    }
  }

  function update(state = navigation.getState()) {
    const { activeGalaxyId, activeSystemId, stage, flight, selected } = state;
    const groupFlight = flight && world.getData(selected)?.kind === 'group';
    const signature = `${activeGalaxyId}:${activeSystemId}:${stage}:${Boolean(groupFlight)}`;
    const query = composing ? renderedQuery : normalize(search.value);
    let contextChanged = false;
    if (contextSignature !== signature) {
      contextSignature = signature;
      const nextContext = destinationContext(state, world);
      contextChanged = context?.key !== nextContext.key;
      context = nextContext;
      overview.title = context.overviewLabel;
      overviewLabel.textContent = context.overviewLabel;
      const deep = activeGalaxyId !== 'galaxy' || activeSystemId !== 'solar' || stage === 'galaxy';
      deepActions.hidden = !deep || stage === 'local-group';
      galaxyReturn.hidden = stage === 'galaxy';
      galaxyReturn.textContent = '↖ ' + world.getData(activeGalaxyId).cn;
      systemOverview.hidden = stage === 'galaxy' || world.getData(activeSystemId)?.kind !== 'star'
        || ![...world.bodies.values()].some(body => body.parentStarId === activeSystemId);
    }
    if (renderedQuery !== query || (!query && contextChanged)) renderItems(query, state);
    else if (selectedId !== selected) setSelected(selected);
    const showClear = search.value.length > 0;
    if (clear && clear.hidden === showClear) clear.hidden = !showClear;
  }
  update();
  return { update };
}
