import assert from 'node:assert/strict';

import {
  chooseContinuationToken,
  pickContinuationToken,
  readContinuation,
  scoreContinuationPath,
} from '../src/core/youtube/continuation.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('reads the legacy continuation renderer token', () => {
  const token = readContinuation({
    continuationItemRenderer: {
      continuationEndpoint: {
        continuationCommand: { token: 'legacy-token' },
      },
    },
  });
  assert.deepEqual(token, { token: 'legacy-token', kind: 'legacy' });
});

check('reads the modern continuation view-model token', () => {
  const token = readContinuation({
    continuationItemViewModel: {
      continuationCommand: {
        innertubeCommand: {
          continuationCommand: { token: 'modern-token' },
        },
      },
    },
  });
  assert.deepEqual(token, { token: 'modern-token', kind: 'modern' });
});

check('video-grid continuation outranks header chip and description tokens', () => {
  const data = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                richGridRenderer: {
                  contents: [
                    { lockupViewModel: { contentId: 'video-1' } },
                    {
                      continuationItemRenderer: {
                        continuationEndpoint: {
                          continuationCommand: { token: 'grid-token-long' },
                        },
                      },
                    },
                  ],
                  header: {
                    chipBarViewModel: {
                      chips: [
                        {
                          chipViewModel: {
                            tapCommand: {
                              innertubeCommand: {
                                continuationCommand: { token: 'chip-token' },
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
    header: {
      pageHeaderRenderer: {
        description: {
          token: 'description-token',
        },
      },
    },
  };

  const candidates = [
    {
      token: 'description-token',
      path: ['header', 'pageHeaderRenderer', 'description'],
      kind: 'legacy',
    },
    {
      token: 'chip-token',
      path: ['richGridRenderer', 'header', 'chipBarViewModel'],
      kind: 'legacy',
    },
    {
      token: 'grid-token-long',
      path: ['richGridRenderer', 'contents', '[30]'],
      kind: 'legacy',
    },
  ];
  assert.equal(pickContinuationToken(candidates), 'grid-token-long');
  assert.equal(scoreContinuationPath(['richGridRenderer', 'contents']), 100);
  assert.equal(scoreContinuationPath(['richGridRenderer', 'header']), 0);
  assert.equal(
    scoreContinuationPath([
      'sectionListRenderer',
      'contents',
      'itemSectionRenderer',
      'contents',
      'gridRenderer',
      'items',
    ]),
    90
  );
});

check('walks a real-shaped page and ignores header-only tokens', () => {
  const data = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                richGridRenderer: {
                  contents: [
                    {
                      continuationItemRenderer: {
                        continuationEndpoint: {
                          continuationCommand: { token: 'grid-token' },
                        },
                      },
                    },
                  ],
                  header: {
                    chipBarViewModel: {
                      chips: [
                        {
                          chipViewModel: {
                            tapCommand: {
                              innertubeCommand: {
                                continuationCommand: { token: 'chip-token' },
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
    header: {
      description: {
        continuationCommand: { token: 'description-token' },
      },
    },
  };
  assert.equal(chooseContinuationToken(data), 'grid-token');
});

console.log(`channel-continuation: ${count} assertions passed`);
