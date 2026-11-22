import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const player = readFileSync(new URL('../app/player.tsx', import.meta.url), 'utf8');

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('the bridge reports the real buffered range', () => {
  assert.match(player, /bufferedStart: buffer\.start/);
  assert.match(player, /bufferedEnd: buffer\.end/);
  assert.match(player, /function bufferedRange\(v\)/);
});

check('portrait progress draws a buffer segment behind the played segment', () => {
  assert.match(player, /styles\.progressBuffer/);
  assert.match(player, /left: bufferLeft/);
  assert.match(player, /width: bufferWidth/);
});

check('landscape progress draws the same buffer segment', () => {
  assert.match(player, /styles\.landProgressBuffer/);
  assert.match(player, /setBufferedEnd\(message\.bufferedEnd\)/);
});

console.log(`player-buffer: ${count} assertions passed`);
