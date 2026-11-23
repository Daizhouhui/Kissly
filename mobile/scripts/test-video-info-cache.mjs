import assert from 'node:assert/strict';
import {
  VIDEO_INFO_TTL_MS,
  normalizeVideoInfo,
  videoInfoFromMeta,
} from '../src/core/youtube/videoInfo.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

const meta = {
  videoId: 'abc123',
  title: 'A video',
  author: 'A channel',
  channelId: 'channel-1',
  lengthSeconds: 3600,
  thumbnail: 'https://example.com/thumb.jpg',
  captionTracks: [],
};

check('video info keeps stable fields only', () => {
  const info = videoInfoFromMeta(meta);
  assert.deepEqual(info, {
    videoId: 'abc123',
    title: 'A video',
    author: 'A channel',
    channelId: 'channel-1',
    lengthSeconds: 3600,
    thumbnail: 'https://example.com/thumb.jpg',
  });
  assert.equal('captionTracks' in info, false);
});

check('video info fills missing optional fields', () => {
  const info = videoInfoFromMeta({
    videoId: 'abc123',
    title: 'A video',
    author: '',
    lengthSeconds: 0,
    thumbnail: '',
  });
  assert.equal(info.channelId, undefined);
  assert.equal(info.lengthSeconds, 0);
});

check('malformed cached values are rejected', () => {
  assert.equal(normalizeVideoInfo(null), null);
  assert.equal(normalizeVideoInfo({ title: 'missing id' }), null);
  assert.equal(normalizeVideoInfo({ videoId: 42 }), null);
});

check('video info cache lives for seven days', () => {
  assert.equal(VIDEO_INFO_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

console.log(`video-info-cache: ${count} assertions passed`);
