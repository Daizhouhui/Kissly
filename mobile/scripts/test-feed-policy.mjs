import assert from 'node:assert/strict';

import {
  shouldStopAutoPagination,
  shouldTranslateTitles,
} from '../src/core/feedPolicy.ts';

assert.equal(
  shouldStopAutoPagination({ attempts: 3, failures: 3, grew: false, anyLive: true }),
  true,
  'persistent network failure must stop the automatic request loop'
);
assert.equal(
  shouldStopAutoPagination({ attempts: 3, failures: 1, grew: false, anyLive: true }),
  true,
  'a partial failure with no progress also stops automatic pagination'
);
assert.equal(
  shouldStopAutoPagination({ attempts: 2, failures: 0, grew: false, anyLive: true }),
  false,
  'successful duplicate pages may advance their cursors'
);
assert.equal(
  shouldStopAutoPagination({ attempts: 2, failures: 0, grew: false, anyLive: false }),
  true,
  'an exhausted feed stops'
);
assert.equal(
  shouldStopAutoPagination({ attempts: 2, failures: 1, grew: true, anyLive: true }),
  false,
  'new content is progress even when another channel failed'
);

console.log('feed-policy: 5 assertions passed');

assert.equal(
  shouldTranslateTitles({ translateTitles: false, titleTranslationMode: 'auto' }),
  false
);
assert.equal(
  shouldTranslateTitles({ translateTitles: true, titleTranslationMode: 'none' }),
  false
);
assert.equal(
  shouldTranslateTitles({ translateTitles: true, titleTranslationMode: 'auto' }),
  true
);
console.log('title-translation-policy: 3 assertions passed');
