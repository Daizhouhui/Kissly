import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ai = readFileSync(new URL('../src/core/translate/ai.ts', import.meta.url), 'utf8');
const index = readFileSync(
  new URL('../src/core/translate/index.ts', import.meta.url),
  'utf8'
);
const defaults = readFileSync(new URL('../src/core/defaults.ts', import.meta.url), 'utf8');

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('OpenRouter uses its OpenAI-compatible chat endpoint', () => {
  assert.match(ai, /https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
});

check('OpenRouter requests carry attribution headers', () => {
  assert.match(ai, /'HTTP-Referer': 'https:\/\/github\.com\/Daizhouhui\/Kissly'/);
  assert.match(ai, /'X-Title': 'Kissly'/);
  assert.equal((ai.match(/\.\.\.\(config\.extraHeaders \?\? \{\}\)/g) ?? []).length, 2);
});

check('the OpenRouter provider is wired into translation and display', () => {
  assert.match(index, /if \(provider === 'openrouter'\)/);
  assert.match(index, /return 'OpenRouter';/);
});

check('OpenRouter is listed and enabled in the paid order', () => {
  assert.match(defaults, /openrouter: 'OpenRouter'/);
  assert.match(
    defaults,
    /autoPaidOrder: \['deepseek', 'siliconflow', 'openrouter', 'openai'\]/
  );
});

console.log(`openrouter-config: ${count} assertions passed`);
