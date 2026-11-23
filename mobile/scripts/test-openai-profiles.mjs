import assert from 'node:assert/strict';

import {
  DEFAULT_OPENAI_MODEL,
  activeOpenAiProfile,
  normalizeOpenAiProfileId,
  normalizeOpenAiProfiles,
  newOpenAiProfile,
} from '../src/core/translate/openaiProfiles.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('old single OpenAI settings become one usable profile', () => {
  const profiles = normalizeOpenAiProfiles(
    undefined,
    'https://proxy.example.com/v1',
    'gpt-4.1-mini'
  );
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].id, 'default');
  assert.equal(profiles[0].baseUrl, 'https://proxy.example.com/v1');
  assert.equal(profiles[0].model, 'gpt-4.1-mini');
  assert.equal(
    normalizeOpenAiProfiles(['malformed'], '', '')[0].id,
    'default'
  );
});

check('profiles keep their order and missing fields are repaired', () => {
  const profiles = normalizeOpenAiProfiles(
    [
      { id: 'work', name: '公司代理', baseUrl: 'https://proxy.example.com/v1' },
      { id: 'local', name: '', baseUrl: '', model: '' },
    ],
    '',
    ''
  );
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].model, DEFAULT_OPENAI_MODEL);
  assert.equal(profiles[1].id, 'local');
  assert.equal(profiles[1].name, '');
  assert.equal(profiles[1].baseUrl, '');
  assert.equal(profiles[1].model, '');
});

check('duplicate or unsafe ids are made unique and stable', () => {
  const profiles = normalizeOpenAiProfiles(
    [
      { id: 'work', name: 'A', baseUrl: 'https://a.example.com', model: 'm' },
      { id: 'work', name: 'B', baseUrl: 'https://b.example.com', model: 'm' },
      { id: 'a/b', name: 'C', baseUrl: 'https://c.example.com', model: 'm' },
    ],
    '',
    ''
  );
  assert.deepEqual(
    profiles.map((profile) => profile.id),
    ['work', 'work-2', 'a-b']
  );
});

check('the active id falls back to the first valid profile', () => {
  const profiles = normalizeOpenAiProfiles([], '', '');
  assert.equal(normalizeOpenAiProfileId('missing', profiles), 'default');
  assert.equal(normalizeOpenAiProfileId(undefined, profiles), 'default');
  assert.equal(normalizeOpenAiProfileId('default', profiles), 'default');
});

check('activeOpenAiProfile follows the selected id', () => {
  const profiles = [
    { id: 'one', name: 'One', baseUrl: 'https://one.example.com', model: 'm1' },
    { id: 'two', name: 'Two', baseUrl: 'https://two.example.com', model: 'm2' },
  ];
  assert.equal(
    activeOpenAiProfile({ openaiProfiles: profiles, openaiProfileId: 'two' }).name,
    'Two'
  );
  assert.equal(
    activeOpenAiProfile({ openaiProfiles: profiles, openaiProfileId: 'gone' }).name,
    'One'
  );
});

check('a new profile gets a unique id and default endpoint', () => {
  const first = newOpenAiProfile(2);
  const second = newOpenAiProfile(3);
  assert.notEqual(first.id, second.id);
  assert.equal(first.baseUrl, 'https://api.openai.com/v1');
  assert.equal(first.model, DEFAULT_OPENAI_MODEL);
  assert.match(first.name, /OpenAI 兼容/);
});

console.log(`openai-profiles: ${count} assertions passed`);
