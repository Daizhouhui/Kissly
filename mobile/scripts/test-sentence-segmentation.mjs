import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cache = new Map();

function loadTs(file) {
  const absolute = resolve(file);
  if (cache.has(absolute)) return cache.get(absolute);
  const compiled = ts.transpileModule(readFileSync(absolute, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  cache.set(absolute, module.exports);
  const requireModule = (id) => {
    if (id.startsWith('.')) return loadTs(resolve(dirname(absolute), `${id}.ts`));
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    console,
    require: requireModule,
  });
  cache.set(absolute, module.exports);
  return module.exports;
}

const { segmentSubtitleCues, splitTextIntoSentences } = loadTs(
  resolve(scriptDir, '../src/ui/sentenceSegmentation.ts')
);

const cases = [
  {
    name: 'repairs a cue split in the middle of a sentence',
    cues: [
      {
        start: 0.32,
        end: 6.32,
        text:
          "You don't just want to get generally better at English speaking. You have a really specific",
        translation: '你不仅仅是想在英语口语上普遍提高。你有一个非常具体的',
      },
      {
        start: 6.32,
        end: 13.76,
        text:
          'goal. You want to improve your American accent. You want a truly natural, easy to understand',
        translation: '目标。你想改善你的美式口音。你想要一个真正自然、易于理解的',
      },
      {
        start: 13.76,
        end: 19.68,
        text:
          "American English voice that's totally different from the voice you use for your native language.",
        translation: '美式英语声音，完全不同于你用于母语的声音。',
      },
    ],
    whole: [
      {
        text: "You don't just want to get generally better at English speaking.",
        translation: '你不仅仅是想在英语口语上普遍提高。',
      },
      { text: 'You have a really specific goal.', translation: '你有一个非常具体的目标。' },
      { text: 'You want to improve your American accent.', translation: '你想改善你的美式口音。' },
      {
        text:
          "You want a truly natural, easy to understand American English voice that's totally different from the voice you use for your native language.",
        translation: '你想要一个真正自然、易于理解的美式英语声音，完全不同于你用于母语的声音。',
      },
    ],
    smart: [
      {
        text: "You don't just want to get generally better at English speaking.",
        translation: '你不仅仅是想在英语口语上普遍提高。',
      },
      { text: 'You have a really specific goal.', translation: '你有一个非常具体的目标。' },
      { text: 'You want to improve your American accent.', translation: '你想改善你的美式口音。' },
      {
        text:
          'You want a truly natural, easy to understand American English voice',
        translation: '你想要一个真正自然、易于理解的美式英语声音，',
      },
      {
        text:
          "that's totally different from the voice you use for your native language.",
        translation: '完全不同于你用于母语的声音。',
      },
    ],
  },
  {
    name: 'keeps a translation aligned when one short source fragment is missing',
    cues: [
      {
        start: 193.36,
        end: 199.04,
        text:
          'The American accent and speaking skills are really neglected in the overall teaching of',
        translation: '美国口音和口语技能在英语整体教学中确实被忽视了',
      },
      {
        start: 199.04,
        end: 205.36,
        text:
          "English. That's where I come in. Working with people from all language backgrounds to be more",
        translation: '这就是我的用武之地。与来自各种语言背景的人合作，让他们更',
      },
      {
        start: 205.36,
        end: 213.28,
        text:
          "easily understood. It's what I do all day, every day. And it's what I've been doing for 20 years.",
        translation: '容易被理解。这是我每天全天都在做的事。也是我做了20年的事。',
      },
    ],
    whole: [
      {
        text:
          'The American accent and speaking skills are really neglected in the overall teaching of English.',
        translation: '美国口音和口语技能在英语整体教学中确实被忽视了',
      },
      { text: "That's where I come in.", translation: '这就是我的用武之地。' },
      {
        text:
          'Working with people from all language backgrounds to be more easily understood.',
        translation: '与来自各种语言背景的人合作，让他们更容易被理解。',
      },
      {
        text: "It's what I do all day, every day.",
        translation: '这是我每天全天都在做的事。',
      },
      {
        text: "And it's what I've been doing for 20 years.",
        translation: '也是我做了20年的事。',
      },
    ],
    smart: [
      {
        text:
          'The American accent and speaking skills are really neglected in the overall teaching of English.',
        translation: '美国口音和口语技能在英语整体教学中确实被忽视了',
      },
      { text: "That's where I come in.", translation: '这就是我的用武之地。' },
      {
        text:
          'Working with people from all language backgrounds to be more easily understood.',
        translation: '与来自各种语言背景的人合作，让他们更容易被理解。',
      },
      {
        text: "It's what I do all day, every day.",
        translation: '这是我每天全天都在做的事。',
      },
      {
        text: "And it's what I've been doing for 20 years.",
        translation: '也是我做了20年的事。',
      },
    ],
  },
];

for (const testCase of cases) {
  for (const mode of ['smart', 'whole']) {
    const actual = segmentSubtitleCues(testCase.cues, mode);
    assert.equal(actual.length, testCase[mode].length, `${testCase.name}: ${mode} length`);
    testCase[mode].forEach((expected, index) => {
      assert.equal(actual[index].text, expected.text, `${testCase.name}: ${mode}[${index}] text`);
      assert.equal(
        actual[index].translation,
        expected.translation,
        `${testCase.name}: ${mode}[${index}] translation`
      );
    });
  }
}

// Google can merge two source sentences into one comma-separated Chinese
// clause. The splitter must not leave the second English card without a
// translation, and must not carry the repeated "目标：" into the next card.
{
  const googleCues = [
    {
      start: 0.32,
      end: 6.32,
      text:
        "You don't just want to get generally better at English speaking. You have a really specific",
      translation: '你不仅仅是想提高英语口语水平，你还有非常具体的目标。',
    },
    {
      start: 6.32,
      end: 13.76,
      text:
        'goal. You want to improve your American accent. You want a truly natural, easy to understand',
      translation: '目标：你想提高你的美式口音。你想要真正自然、易于理解的口音。',
    },
  ];
  for (const mode of ['smart', 'whole']) {
    const actual = segmentSubtitleCues(googleCues, mode);
    assert.equal(actual[1].text, 'You have a really specific goal.', `${mode}: google card text`);
    assert.equal(
      actual[1].translation,
      '你还有非常具体的目标。',
      `${mode}: google card translation`
    );
    assert.equal(
      actual[2].translation,
      '你想提高你的美式口音。',
      `${mode}: google repeated-prefix translation`
    );
  }
}

function assertPieces(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

assertPieces(splitTextIntoSentences('This is a galaxy .'), ['This is a galaxy.']);
assertPieces(splitTextIntoSentences('It costs $3.50 today.'), ['It costs $3.50 today.']);
assertPieces(splitTextIntoSentences('Mr. Smith is here.'), ['Mr. Smith is here.']);
assertPieces(splitTextIntoSentences('I live in the U.S. It is big.'), [
  'I live in the U.S.',
  'It is big.',
]);
assertPieces(splitTextIntoSentences('你好。世界！'), ['你好。', '世界！']);
assertPieces(splitTextIntoSentences('“Hello.” Next sentence.'), [
  '“Hello.”',
  'Next sentence.',
]);

const asrCues = [
  {
    start: 27.28,
    end: 33.86,
    text:
      'An important clue appeared when astronomers tried to create computer simulations to study the evolution of galaxies',
  },
  {
    start: 33.86,
    end: 37.38,
    text: 'like ours , which are called spiral galaxies .',
  },
  {
    start: 37.38,
    end: 44.28,
    text:
      'Their most striking feature is the presence of long arms of dust and stars extending from the center .',
  },
];
const whole = segmentSubtitleCues(asrCues, 'whole');
assert.equal(whole.length, 2, 'ASR whole: cross-cue sentence is merged');
assert.equal(
  whole[0].text,
  'An important clue appeared when astronomers tried to create computer simulations to study the evolution of galaxies like ours, which are called spiral galaxies.'
);
assert.equal(
  whole[1].text,
  'Their most striking feature is the presence of long arms of dust and stars extending from the center.'
);

const fragmented = segmentSubtitleCues(
  [
    { start: 0, end: 2, text: 'I was thinking about' },
    { start: 2, end: 4, text: 'the problem all night.' },
  ],
  'whole'
);
assert.equal(fragmented.length, 1);
assert.equal(fragmented[0].text, 'I was thinking about the problem all night.');

const honorific = segmentSubtitleCues(
  [
    { start: 0, end: 2, text: 'Hi Mr.' },
    { start: 2, end: 4, text: 'Hinkel.' },
  ],
  'whole'
);
assert.equal(honorific.length, 1, 'honorific: Mr. and name stay together');
assert.equal(honorific[0].text, 'Hi Mr. Hinkel.');

const msHonorific = segmentSubtitleCues(
  [
    { start: 0, end: 1, text: 'Ms.' },
    { start: 1, end: 4, text: 'Martin, why is my shadow gone?' },
  ],
  'smart'
);
assert.equal(msHonorific.length, 1, 'honorific: Ms. and name stay together');
assert.equal(msHonorific[0].text, 'Ms. Martin, why is my shadow gone?');

const usAbbreviation = segmentSubtitleCues(
  [
    { start: 0, end: 2, text: 'He worked for the U.S.' },
    { start: 2, end: 5, text: 'government for years.' },
  ],
  'whole'
);
assert.equal(usAbbreviation.length, 1, 'U.S. before lowercase stays in the sentence');
assert.equal(usAbbreviation[0].text, 'He worked for the U.S. government for years.');

const usSentenceEnd = segmentSubtitleCues(
  [
    { start: 0, end: 2, text: 'I live in the U.S.' },
    { start: 2, end: 5, text: 'It is big.' },
  ],
  'whole'
);
assert.equal(usSentenceEnd.length, 2, 'U.S. before a new sentence is terminal');
assert.equal(usSentenceEnd[0].text, 'I live in the U.S.');
assert.equal(usSentenceEnd[1].text, 'It is big.');

const soMuch = segmentSubtitleCues(
  [
    {
      start: 0,
      end: 10,
      text:
        "His placement is so different, so much lower, and so much more natural for American English after 4 weeks of working on his placement in the Academy.",
    },
  ],
  'smart'
);
assert.equal(soMuch.length, 2, 'smart: a long sentence is split into balanced chunks');
const soMuchLengths = soMuch.map((cue) => cue.text.length);
assert.ok(
  Math.max(...soMuchLengths) - Math.min(...soMuchLengths) <= 20,
  'smart: chunk lengths stay close to the balanced ideal'
);
assert.ok(
  soMuch.every(
    (cue) =>
      !/\b(?:and|for|to|so|because|but)$/u.test(cue.text) &&
      !/^so much/u.test(cue.text)
  ),
  'smart: does not leave a dangling function word at a card edge'
);

const shortSentence = segmentSubtitleCues(
  [
    {
      start: 0,
      end: 4,
      text: 'This is a short sentence that should stay on one card.',
    },
  ],
  'smart'
);
assert.equal(shortSentence.length, 1, 'smart: short sentences stay whole');

const thousands = segmentSubtitleCues(
  [
    {
      start: 0,
      end: 10,
      text:
        "I've helped more than 1,000 students, and over the years I've learned a lot from every single one of them.",
    },
  ],
  'smart'
);
assert.ok(
  thousands.every((cue) => !/1,$/u.test(cue.text) && !/^000/u.test(cue.text)),
  'smart: never cuts a thousands separator in half'
);

console.log('sentence segmentation: all assertions passed');
