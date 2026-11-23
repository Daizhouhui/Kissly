import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../app/player.tsx', import.meta.url), 'utf8');

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('the bridge exposes a precise pauseAt timer', () => {
  assert.match(source, /pauseAt:\s*function\(seconds\)\{/);
  assert.match(source, /\},\s*16\);/);
});

check('blind playback arms the pause at the current cue end', () => {
  assert.match(source, /const armPrecisionPause = /);
  assert.match(source, /window\.__kiss\.pauseAt\(\$\{cue\.end\}\)/);
  const start = source.indexOf('const togglePrecisionPlay');
  const end = source.indexOf('const seekTo =', start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /armPrecisionPause\(precisionCue\)/);
});

check('jump, entry and repeat paths re-arm the pause', () => {
  assert.match(source, /armPrecisionPause\(target\)/);
  assert.match(source, /armPrecisionPause\(precisionCue\)/);
});

check('leaving blind mode cancels a pending pause', () => {
  assert.match(source, /clearPrecisionPause\(\)/);
  assert.match(source, /window\.__kiss\.pauseAt\(-1\)/);
});

console.log(`precision-pause: ${count} assertions passed`);
