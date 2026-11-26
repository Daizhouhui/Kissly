import { segmentSubtitleCues, smartBoundaries } from '../src/ui/sentenceSegmentation.ts';

const cues = [
  {
    start: 0.32,
    end: 6.32,
    text: "You don't just want to get generally better at English speaking. You have a really specific",
    translation: '你不仅仅是想在英语口语上普遍提高。你有一个非常具体的',
  },
  {
    start: 6.32,
    end: 13.76,
    text: 'goal. You want to improve your American accent. You want a truly natural, easy to understand',
    translation: '目标。你想改善你的美式口音。你想要一个真正自然、易于理解的',
  },
  {
    start: 13.76,
    end: 19.68,
    text:
      "American English voice that's totally different from the voice you use for your native language.",
    translation: '美式英语声音，完全不同于你用于母语的声音。',
  },
];

for (const mode of ['whole', 'smart']) {
  console.log('\nMODE', mode);
  for (const cue of segmentSubtitleCues(cues, mode)) {
    console.log(cue.start, cue.end, JSON.stringify(cue.text), '|', JSON.stringify(cue.translation));
  }
}
const long = "You want a truly natural, easy to understand American English voice that's totally different from the voice you use for your native language.";
console.log('long len', long.length, 'boundaries', smartBoundaries(long), 'comma', long.indexOf(','));
