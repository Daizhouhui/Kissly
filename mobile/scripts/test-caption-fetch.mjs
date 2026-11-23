import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function compileModule(fileUrl) {
  const file = readFileSync(fileUrl, 'utf8');
  return ts.transpileModule(file, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadParse() {
  const module = { exports: {} };
  const utilsModule = { exports: {} };
  vm.runInNewContext(
    compileModule(new URL('../src/core/utils.ts', import.meta.url)),
    { module: utilsModule, exports: utilsModule.exports, console }
  );
  vm.runInNewContext(
    compileModule(new URL('../src/core/youtube/parse.ts', import.meta.url)),
    {
      module,
      exports: module.exports,
      console,
      require(id) {
        if (id === '../utils') return utilsModule.exports;
        throw new Error(`Unexpected parse import: ${id}`);
      },
    }
  );
  return module.exports;
}

function loadInnertube(httpText) {
  const compiled = compileModule(
    new URL('../src/core/youtube/innertube.ts', import.meta.url)
  );
  const parse = loadParse();
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require(id) {
      if (id === '../http') return { httpText };
      if (id === './parse') return parse;
      if (id === './captionCache') return { saveCaptionCache: async () => {} };
      throw new Error(`Unexpected import: ${id}`);
    },
    console,
    URL,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(compiled, context);
  return module.exports;
}

const track = {
  languageCode: 'en',
  baseUrl: 'https://captions.example/en',
  isAsr: false,
};
const completeText = `WEBVTT

00:00:00.000 --> 00:00:05.000
one

00:00:05.000 --> 00:00:10.000
two
`;

async function check(name, fn) {
  await fn();
  console.log(`  ok ${name}`);
}

await check('a complete original track stops after one caption request', async () => {
  const calls = [];
  const { fetchCaptionCues } = loadInnertube(async (url) => {
    calls.push(String(url));
    return { status: 200, text: completeText };
  });
  const cues = await fetchCaptionCues(track, 10);
  assert.ok(cues.length > 0);
  assert.equal(cues[cues.length - 1].end, 10);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], track.baseUrl);
});

await check('a truncated track tries the next format but stops once complete', async () => {
  const calls = [];
  const { fetchCaptionCues } = loadInnertube(async (url) => {
    const value = String(url);
    calls.push(value);
    return {
      status: 200,
      text:
        value === track.baseUrl
          ? 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\ntruncated\n'
          : completeText,
    };
  });
  const cues = await fetchCaptionCues(track, 10);
  assert.ok(cues.length > 0);
  assert.equal(cues[cues.length - 1].end, 10);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /fmt=json3/);
  assert.match(calls[1], /c=ANDROID/);
});

console.log('caption-fetch: 2 checks passed');
