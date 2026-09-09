import assert from 'node:assert/strict';
import test from 'node:test';
import { playSectionQueue } from '../section-queue.js';

for (const source of ['home_single_card', 'home_feature_card', 'feature_card']) {
  test(`${source}: start and explicit restart retain the whole section queue`, () => {
    const items = ['a', 'b', 'c'].map(slug => ({ id: slug, slug, src: `/${slug}.mp3`, source }));
    const calls = [];
    const bridge = { queue: items, currentTrack: items[1], playbackState: 'idle', playQueue: (...args) => calls.push(args) };
    playSectionQueue({ items, clickedItem: items[1], source, bridge, toTrack: t => t });
    assert.deepEqual(calls[0], [items, 1, { resumeAt: 0, autoAdvance: true }]);
  });
  test(`${source}: tapping an active song toggles only its own section queue`, () => {
    const track = { id: 'a', slug: 'a', src: '/a.mp3', source };
    let toggled = 0;
    let queued = 0;
    const bridge = { currentTrack: track, queue: [track], playbackState: 'playing',
      toggle: () => toggled++, playQueue: () => queued++ };
    playSectionQueue({ items: [track], clickedItem: track, source, bridge, toTrack: t => t });
    assert.equal(toggled, 1);
    bridge.queue = [{ ...track, source: 'playlist' }];
    playSectionQueue({ items: [track], clickedItem: track, source, bridge, toTrack: t => t });
    assert.equal(toggled, 1);
    assert.equal(queued, 1);
  });
}
test('filtering unavailable songs preserves the clicked song index', () => {
  const items = [{ slug: 'unavailable' }, { slug: 'b', src: '/b.mp3' }, { slug: 'c', src: '/c.mp3' }];
  let result;
  playSectionQueue({ items, clickedItem: items[2], source: 'home_single_card',
    toTrack: t => t, bridge: { playQueue: (queue, index) => result = { queue, index } } });
  assert.equal(result.index, 1);
  assert.equal(result.queue[result.index].slug, 'c');
});
