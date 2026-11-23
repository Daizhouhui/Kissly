import assert from 'node:assert/strict';

import { shouldProbeYoutubeLogin } from '../src/ui/youtube-login-probe-path.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('a cold start on the video tab does not mount the hidden probe', () => {
  assert.equal(shouldProbeYoutubeLogin('/'), false);
  assert.equal(shouldProbeYoutubeLogin('/video'), false);
});

check('the player and settings screens do not mount the probe', () => {
  assert.equal(shouldProbeYoutubeLogin('/player'), false);
  assert.equal(shouldProbeYoutubeLogin('/settings/translation'), false);
});

check('the me tab mounts the probe', () => {
  assert.equal(shouldProbeYoutubeLogin('/me'), true);
  assert.equal(shouldProbeYoutubeLogin('/me/'), true);
  assert.equal(shouldProbeYoutubeLogin('/(tabs)/me'), true);
});

check('query strings and trailing slashes are ignored', () => {
  assert.equal(shouldProbeYoutubeLogin('/me?from=player'), true);
  assert.equal(shouldProbeYoutubeLogin('/player?next=/me'), false);
});

console.log(`youtube-login-probe-path: ${count} assertions passed`);
