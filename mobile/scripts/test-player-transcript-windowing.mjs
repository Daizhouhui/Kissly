import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../app/player.tsx', import.meta.url), 'utf8');

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('the transcript is rendered by a virtualized FlatList', () => {
  assert.match(source, /<FlatList[\s\S]*?data=\{cues\}/);
});

check('the transcript keeps a bounded window size', () => {
  assert.match(source, /windowSize=\{5\}/);
});

check('the transcript uses a small initial batch', () => {
  assert.match(source, /initialNumToRender=\{12\}/);
});

check('the old render-everything map is gone', () => {
  assert.doesNotMatch(source, /cues\.map\(/);
});

console.log(`player-transcript-windowing: ${count} assertions passed`);
