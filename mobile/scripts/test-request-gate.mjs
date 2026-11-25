import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);

const {
  MAX_COOLDOWN_MS,
  parseRetryAfterMs,
  providerGateSnapshot,
  resetProviderGate,
  withProviderGate,
} = await import('../src/core/translate/requestGate.ts');

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

async function checkAsync(name, fn) {
  await fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await checkAsync('at most two requests run at once and starts respect the interval', async () => {
  resetProviderGate();
  let active = 0;
  let maxActive = 0;
  const starts = [];
  const tasks = Array.from({ length: 8 }, () =>
    withProviderGate('google', async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      starts.push(Date.now());
      await sleep(250);
      active -= 1;
      return { status: 200 };
    })
  );
  await Promise.all(tasks);
  assert.equal(maxActive, 2, 'google free must stay at two in-flight');
  starts.sort((a, b) => a - b);
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok(
      starts[index] - starts[index - 1] >= 195,
      `google starts must be >=200ms apart (got ${starts[index] - starts[index - 1]}ms)`
    );
  }
});

await checkAsync('a 429 sets a cooldown before the next request', async () => {
  resetProviderGate();
  const startedAt = Date.now();
  const result = await withProviderGate('google2', async () => ({
    status: 429,
    text: 'rate limited',
    headers: { get: () => '0.3' },
  }));
  assert.equal(result.status, 429);

  const snapshot = providerGateSnapshot('google2');
  const cooldown = snapshot.cooldownUntil - Date.now();
  assert.ok(cooldown > 0 && cooldown <= 320, `cooldown should be ~300ms (got ${cooldown})`);

  let nextStart = 0;
  await withProviderGate('google2', async () => {
    nextStart = Date.now();
    return { status: 200 };
  });
  assert.ok(
    nextStart - startedAt >= 280,
    `the next request must wait for the cooldown (${nextStart - startedAt}ms)`
  );
});

await checkAsync('a huge Retry-After is clamped to 30s', async () => {
  resetProviderGate();
  await withProviderGate('openrouter', async () => ({
    status: 429,
    text: '',
    headers: { get: () => '999' },
  }));
  const snapshot = providerGateSnapshot('openrouter');
  const cooldown = snapshot.cooldownUntil - Date.now();
  assert.ok(cooldown > MAX_COOLDOWN_MS - 1500, `cooldown near 30s (got ${cooldown})`);
  assert.ok(cooldown <= MAX_COOLDOWN_MS + 50, `cooldown never above 30s (got ${cooldown})`);
});

await checkAsync('a thrown request releases its slot', async () => {
  resetProviderGate();
  await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      withProviderGate('microsoft', async () => {
        throw new Error('boom');
      })
    )
  );
  const ok = await Promise.race([
    withProviderGate('microsoft', async () => ({ status: 200 })),
    sleep(1000).then(() => 'timeout'),
  ]);
  assert.notEqual(ok, 'timeout', 'a leaked slot would hang this request');
});

await checkAsync('a thrown 429 also cools the provider down', async () => {
  resetProviderGate();
  const error = new Error('429');
  error.status = 429;
  await assert.rejects(
    withProviderGate('deepseek', async () => {
      throw error;
    }),
    /429/
  );
  const snapshot = providerGateSnapshot('deepseek');
  assert.ok(snapshot.cooldownUntil - Date.now() > 1000, 'default 2s cooldown is applied');
});

check('Retry-After parses seconds, HTTP dates and garbage', () => {
  assert.equal(parseRetryAfterMs('8'), 8000);
  assert.equal(parseRetryAfterMs('2.5'), 2500);
  assert.equal(parseRetryAfterMs('nonsense'), null);
  const now = Date.now();
  const future = new Date(now + 10000).toUTCString();
  const parsed = parseRetryAfterMs(future, now);
  assert.ok(parsed >= 9000 && parsed <= 10000, `HTTP date parsed (got ${parsed})`);
  assert.equal(parseRetryAfterMs(new Date(now - 5000).toUTCString(), now), 0);
});

console.log(`request-gate: ${count} checks passed`);
