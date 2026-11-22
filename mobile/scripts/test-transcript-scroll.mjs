import assert from 'node:assert/strict';

import {
  pageScrollTarget,
  shouldPageJump,
} from '../src/ui/transcriptScroll.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('page mode stays still while the active line is visible', () => {
  assert.equal(shouldPageJump(200, 260, 100, 400), false);
});

check('page mode jumps when the active line reaches the viewport bottom', () => {
  assert.equal(shouldPageJump(450, 510, 100, 400), true);
});

check('page mode does not jump before the layout height is known', () => {
  assert.equal(shouldPageJump(450, 510, 0, 0), false);
});

check('the page jump leaves a small gap above the active line', () => {
  assert.equal(pageScrollTarget(450), 426);
  assert.equal(pageScrollTarget(10), 0);
});

console.log(`transcript-scroll: ${count} assertions passed`);
