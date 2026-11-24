import assert from 'node:assert/strict';

import { parseChannelInfo, parseCountLabel } from '../src/core/youtube/channelMetadata.ts';

assert.equal(parseCountLabel('2.69M subscribers'), 2690000);
assert.equal(parseCountLabel('6.1K videos'), 6100);
assert.equal(parseCountLabel('1.2万位订阅者'), 12000);
assert.equal(parseCountLabel('1,234 videos'), 1234);
assert.equal(parseCountLabel('11 videos'), 11);
assert.equal(parseCountLabel('No videos'), 0);
assert.equal(parseCountLabel(''), undefined);

const info = parseChannelInfo({
  header: {
    pageHeaderRenderer: {
      content: {
        pageHeaderViewModel: {
          metadata: {
            contentMetadataViewModel: {
              metadataRows: [
                { metadataParts: [{ text: { content: '@GoogleDevelopers' } }] },
                {
                  metadataParts: [
                    { text: { content: '2.69M subscribers' } },
                    { text: { content: '6.1K videos' } },
                  ],
                },
              ],
            },
          },
          description: {
            descriptionPreviewViewModel: {
              description: { content: 'Welcome to Google for Developers!' },
            },
          },
        },
      },
    },
  },
});

assert.deepEqual(info, {
  handle: '@GoogleDevelopers',
  subscriberCount: 2690000,
  videoCount: 6100,
  description: 'Welcome to Google for Developers!',
});
assert.equal(parseChannelInfo({}), undefined);

console.log('channel-metadata: 10 assertions passed');
