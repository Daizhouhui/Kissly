import assert from 'node:assert/strict';

import { parseTakeoutCsv } from '../src/core/youtube/takeout.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

const HEADER = 'Channel ID,Channel URL,Channel Title';

check('takeout rows keep the URL out of the group field', () => {
  const subs = parseTakeoutCsv(
    [
      HEADER,
      'UCaaaaaaaaaaaaaaaaaaaaaa,https://www.youtube.com/@SomeHandle,Some Channel',
      'UCbbbbbbbbbbbbbbbbbbbbbb,https://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb,Another Channel',
    ].join('\n')
  );
  assert.equal(subs.length, 2);
  assert.equal(subs[0].channelId, 'UCaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(subs[0].title, 'Some Channel');
  assert.equal(subs[0].handle, '@SomeHandle');
  assert.equal(subs[0].group, undefined);
  assert.equal(subs[1].handle, undefined);
  assert.equal(subs[1].group, undefined);
});

check('quoted titles with commas survive and duplicates are collapsed', () => {
  const subs = parseTakeoutCsv(
    [
      HEADER,
      'UCaaaaaaaaaaaaaaaaaaaaaa,https://www.youtube.com/@A,"Hello, World"',
      'UCaaaaaaaaaaaaaaaaaaaaaa,https://www.youtube.com/@A,"Hello, World"',
    ].join('\r\n')
  );
  assert.equal(subs.length, 1);
  assert.equal(subs[0].title, 'Hello, World');
});

check('an explicit group column is kept as a real group', () => {
  const subs = parseTakeoutCsv(
    [
      'Channel ID,Group,Channel URL,Channel Title',
      'UCaaaaaaaaaaaaaaaaaaaaaa,English,https://www.youtube.com/@A,Channel A',
      'UCbbbbbbbbbbbbbbbbbbbbbb,Japanese,https://www.youtube.com/@B,Channel B',
    ].join('\n')
  );
  assert.equal(subs[0].group, 'English');
  assert.equal(subs[1].group, 'Japanese');
  assert.equal(subs[0].handle, '@A');
});

check('a CSV without a Channel ID column is rejected', () => {
  assert.throws(
    () => parseTakeoutCsv('Title,URL\nFoo,https://www.youtube.com/@foo'),
    /Channel ID/
  );
});

check('Kissly’s own export round-trips titles and handles', () => {
  const subs = parseTakeoutCsv(
    [
      'channelId,title,handle,url',
      'UCaaaaaaaaaaaaaaaaaaaaaa,"Channel A",@A,https://www.youtube.com/@A',
      'UCbbbbbbbbbbbbbbbbbbbbbb,"Channel B",,https://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb',
    ].join('\n')
  );
  assert.equal(subs[0].title, 'Channel A');
  assert.equal(subs[0].handle, '@A');
  assert.equal(subs[1].title, 'Channel B');
});

console.log(`takeout-csv: ${count} assertions passed`);
