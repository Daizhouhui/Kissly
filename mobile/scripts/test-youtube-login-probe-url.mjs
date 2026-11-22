import assert from 'node:assert/strict';

import { isAllowedYoutubeProbeUrl } from '../src/ui/youtube-login-probe-url.ts';

let count = 0;
function check(name, url, expected) {
  assert.equal(isAllowedYoutubeProbeUrl(url), expected, name);
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('allows the mobile YouTube login feed', 'https://m.youtube.com/feed/channels?hl=zh-CN', true);
check('allows consent.youtube.com', 'https://consent.youtube.com/m?continue=x', true);
check('allows accounts.google.com', 'https://accounts.google.com/ServiceLogin?x=1', true);
check('allows gstatic subresources', 'https://www.gstatic.com/logo.png', true);
check('allows avatar hosts', 'https://yt3.ggpht.com/avatar.jpg', true);
check('allows about:blank', 'about:blank', true);
check('rejects an arbitrary host with youtube.com in the path', 'https://evil.example/?youtube.com', false);
check('rejects an arbitrary host with a youtube.com suffix', 'https://youtube.com.evil.example/', false);
check('rejects an arbitrary host with a google.com prefix', 'https://google.com.evil.example/', false);
check('rejects plain http YouTube', 'http://m.youtube.com/feed/channels', false);
check('rejects file URLs', 'file:///etc/passwd', false);

console.log(`youtube-login-probe-url: ${count} assertions passed`);
