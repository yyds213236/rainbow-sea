import test from 'node:test';
import assert from 'node:assert/strict';
import { destinationSearchIndex, searchDestinations } from '../src/ui/destinations.js';

test('the search index includes each navigable category once', () => {
  const earth = { id: 'earth', cn: '地球' };
  const distantWorld = { id: 'trappist-1-e', cn: 'TRAPPIST-1 e' };
  const atlas = { id: 'local-group', cn: '星系图鉴' };
  const galaxy = { id: 'andromeda', cn: '仙女座星系', index: 'M31' };
  const station = { id: 'iss', cn: '空间站' };
  const entries = [earth, distantWorld, atlas, galaxy, station];
  const catalog = new Map(entries.map(entry => [entry.id, entry]));
  const index = destinationSearchIndex({
    bodies: new Map([[earth.id, earth], [distantWorld.id, distantWorld]]),
    galaxyDefinitions: [galaxy],
    getData: id => catalog.get(id),
  });

  assert.equal(index.length, entries.length);
  assert.deepEqual(new Set(index), new Set(entries));
  assert.deepEqual(searchDestinations(index, 'ｔｒａｐｐｉｓｔ－１ ｅ'), [distantWorld]);
  assert.deepEqual(searchDestinations(index, '国际空间站'), [station]);
  assert.deepEqual(searchDestinations(index, 'M 31'), [galaxy]);
});

test('catalog searches put exact matches before partial matches and leave the index intact', () => {
  const partial = { id: 'm31-black-hole', cn: '仙女座中央黑洞', index: 'M31*' };
  const exact = { id: 'andromeda', cn: '仙女座星系', index: 'M31' };
  const unrelated = { id: 'solar', cn: '太阳系' };
  const index = [partial, unrelated, exact];

  assert.deepEqual(searchDestinations(index, 'ｍ－３１'), [exact, partial]);
  assert.deepEqual(searchDestinations(index, 'Andromeda'), [exact]);
  assert.deepEqual(searchDestinations(index, '不存在的天体'), []);
  assert.deepEqual(searchDestinations(index, '   '), []);
  assert.deepEqual(index, [partial, unrelated, exact]);
});
