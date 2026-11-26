import fs from 'node:fs';
import { segmentSubtitleCues } from '../src/ui/sentenceSegmentation.ts';

const cues = JSON.parse(fs.readFileSync(new URL('./seg-input.json', import.meta.url), 'utf8'));
const mode = process.argv[2] || 'smart';
const output = segmentSubtitleCues(cues, mode);
console.log('input', cues.length, 'output', output.length, 'mode', mode);
for (const [index, cue] of output.entries()) {
  const duration = (cue.end - cue.start).toFixed(2);
  console.log(
    String(index).padStart(3),
    cue.start.toFixed(2),
    cue.end.toFixed(2),
    duration.padStart(5),
    JSON.stringify(cue.text),
    '|',
    JSON.stringify(cue.translation)
  );
}
