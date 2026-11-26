import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);

const { fontWeightFor } = await import('../src/core/subtitleWeights.ts');
const { subtitleTextMetrics } = await import('../src/ui/subtitleTypography.ts');

const base = (patch) => ({
  surface: 'portrait',
  line: 'original',
  mode: 'bilingual',
  baseSize: 20,
  weight: 'medium',
  ...patch,
});

// 1. Portrait and precision listening use exactly the same formula.
const portrait20 = subtitleTextMetrics(base({ surface: 'portrait' }));
const listening20 = subtitleTextMetrics(base({ surface: 'listening' }));
assert.deepEqual(portrait20, listening20);
assert.equal(portrait20.fontSize, 20);
assert.equal(portrait20.lineHeight, 28);
assert.equal(portrait20.fontWeight, '600');

// 2. Listening no longer adds a hidden +4.
assert.equal(
  subtitleTextMetrics(base({ surface: 'listening', baseSize: 20 })).fontSize,
  20
);
assert.equal(
  subtitleTextMetrics(base({ surface: 'listening', baseSize: 30 })).fontSize,
  30
);

// 3. Portrait translation keeps the -3 offset in bilingual mode, full size
//    when the translation is the only visible line.
assert.equal(
  subtitleTextMetrics(base({ line: 'translation' })).fontSize,
  17
);
assert.equal(
  subtitleTextMetrics(base({ line: 'translation' })).lineHeight,
  25
);
assert.equal(
  subtitleTextMetrics(base({ line: 'translation', mode: 'translation' })).fontSize,
  20
);
assert.equal(
  subtitleTextMetrics(base({ line: 'translation', mode: 'translation' })).lineHeight,
  30
);

// 4. Landscape translation keeps -5 in bilingual mode and uses the natural
//    font line height rather than a hardcoded one.
const landscape = subtitleTextMetrics(
  base({ surface: 'landscape', baseSize: 24 })
);
assert.equal(landscape.fontSize, 24);
assert.equal(landscape.lineHeight, undefined);
assert.equal(
  subtitleTextMetrics(
    base({ surface: 'landscape', line: 'translation', baseSize: 24 })
  ).fontSize,
  19
);
assert.equal(
  subtitleTextMetrics(
    base({ surface: 'landscape', line: 'translation', mode: 'translation', baseSize: 24 })
  ).fontSize,
  24
);

// 5. Preview scaling only changes type size; the ratio is preserved.
const scaled = subtitleTextMetrics(
  base({ surface: 'landscape', baseSize: 24, scale: 0.4 })
);
assert.equal(scaled.fontSize, 9.6);
assert.equal(scaled.lineHeight, undefined);

// 6. Five weights map to the same CSS numeric scale everywhere.
assert.equal(fontWeightFor('regular'), '400');
assert.equal(fontWeightFor('normal'), '500');
assert.equal(fontWeightFor('medium'), '600');
assert.equal(fontWeightFor('bold'), '700');
assert.equal(fontWeightFor('heavy'), '800');

console.log('subtitle-typography: 22 assertions passed');
