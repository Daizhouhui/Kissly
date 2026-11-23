#!/usr/bin/env node
/**
 * Tiny Chrome DevTools Protocol client for a debug WebView.
 *
 * Setup (once per app launch):
 *   bash scripts/dev/device.sh forward
 *
 * Usage:
 *   node scripts/dev/cdp.mjs targets [url-or-title-substring]
 *   node scripts/dev/cdp.mjs eval "<js expression>" [--match <substring>]
 *   node scripts/dev/cdp.mjs reload [--match <substring>]
 *   node scripts/dev/cdp.mjs navigate <url> [--match <substring>]
 *   node scripts/dev/cdp.mjs net [seconds] [--match <substring>]
 *   node scripts/dev/cdp.mjs console [seconds] [--match <substring>]
 *
 * Environment:
 *   KISSLY_CDP_PORT   default 9222
 *
 * Notes:
 * - WebView debugging is only enabled in debug builds.
 * - `eval` runs in the page with a user gesture, so play()/requestFullscreen()
 *   are allowed. The result is printed; objects and JSON-looking strings are
 *   pretty-printed.
 * - When several WebViews are open (account page + player), pass
 *   `--match youtube.com/watch` to choose the player target.
 * - `net` reloads the page and reports failed / 4xx / 5xx requests.
 * - `console` attaches without reloading and prints console/exception events.
 */

import http from 'node:http';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let WebSocket;
try {
  WebSocket = require('ws');
} catch {
  console.error("Missing dependency 'ws'. Run `npm install` in mobile/ first.");
  process.exit(1);
}

const PORT = Number(process.env.KISSLY_CDP_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${path}`, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve(data));
    });
    req.on('error', (error) => reject(error));
    req.setTimeout(5000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function getTargets() {
  let raw;
  try {
    raw = await httpGet('/json');
  } catch (error) {
    console.error(
      `Cannot reach ${BASE}/json (${error.message}).\n` +
        'Run: bash scripts/dev/device.sh forward'
    );
    process.exit(1);
  }
  const list = JSON.parse(raw || '[]');
  return list.filter((item) => item.type === 'page');
}

function printTargets(targets) {
  if (!targets.length) {
    console.log('No WebView page targets. Is the app showing a WebView?');
    return;
  }
  targets.forEach((target, index) => {
    console.log(
      `[${index}] ${target.title || '(untitled)'}\n    ${target.url}\n    ${target.webSocketDebuggerUrl}`
    );
  });
}

function pickTarget(targets, match) {
  if (match) {
    const found = targets.find(
      (target) =>
        String(target.url || '').includes(match) ||
        String(target.title || '').includes(match)
    );
    if (!found) {
      console.error(`No target matches "${match}".`);
      printTargets(targets);
      process.exit(1);
    }
    return found;
  }
  if (!targets.length) {
    console.error('No WebView page targets. Is the app showing a WebView?');
    process.exit(1);
  }
  return targets[0];
}

function openTarget(target) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.on('open', () => resolve(socket));
    socket.on('error', reject);
  });
}

function command(socket, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = command.nextId++;
    const onMessage = (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.id !== id) return;
      socket.off('message', onMessage);
      if (message.error) {
        reject(new Error(`${method}: ${message.error.message}`));
        return;
      }
      resolve(message.result);
    };
    socket.on('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
command.nextId = 1;

function parseArgs(rawArgs) {
  const args = [...rawArgs];
  const matchIndex = args.indexOf('--match');
  let match = '';
  if (matchIndex >= 0) {
    match = args[matchIndex + 1] || '';
    args.splice(matchIndex, 2);
  }
  return { args, match };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cmdTargets(rawArgs) {
  const targets = await getTargets();
  if (rawArgs[0]) {
    printTargets(
      targets.filter(
        (target) =>
          String(target.url || '').includes(rawArgs[0]) ||
          String(target.title || '').includes(rawArgs[0])
      )
    );
    return;
  }
  printTargets(targets);
}

async function cmdEval(rawArgs, match) {
  const expression = rawArgs.join(' ');
  if (!expression) {
    console.error('usage: cdp.mjs eval "<js expression>" [--match <substring>]');
    process.exit(1);
  }
  const target = pickTarget(await getTargets(), match);
  const socket = await openTarget(target);
  try {
    const result = await command(socket, 'Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      console.error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          'evaluation failed'
      );
      process.exitCode = 1;
      return;
    }
    const remote = result.result || {};
    if (remote.value === undefined) {
      console.log(remote.description || JSON.stringify(remote));
      return;
    }
    const value = remote.value;
    if (value !== null && typeof value === 'object') {
      console.log(JSON.stringify(value, null, 2));
      return;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          console.log(JSON.stringify(JSON.parse(trimmed), null, 2));
          return;
        } catch {
          // Not JSON; print as-is.
        }
      }
    }
    console.log(value);
  } finally {
    socket.close();
  }
}

async function cmdReload(_rawArgs, match) {
  const target = pickTarget(await getTargets(), match);
  const socket = await openTarget(target);
  try {
    await command(socket, 'Page.enable');
    await command(socket, 'Page.reload', { ignoreCache: false });
    console.log(`reloaded ${target.url}`);
  } finally {
    socket.close();
  }
}

async function cmdNavigate(rawArgs, match) {
  const url = rawArgs[0];
  if (!url) {
    console.error('usage: cdp.mjs navigate <url> [--match <substring>]');
    process.exit(1);
  }
  const target = pickTarget(await getTargets(), match);
  const socket = await openTarget(target);
  try {
    await command(socket, 'Page.enable');
    await command(socket, 'Page.navigate', { url });
    console.log(`navigating ${target.url} -> ${url}`);
  } finally {
    socket.close();
  }
}

async function cmdNet(rawArgs, match) {
  const seconds = Number(rawArgs[0]) > 0 ? Number(rawArgs[0]) : 10;
  const target = pickTarget(await getTargets(), match);
  const socket = await openTarget(target);
  const failures = [];
  const badStatuses = [];
  try {
    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.method === 'Network.loadingFailed') {
        failures.push({
          error: message.params.errorText,
          type: message.params.type,
          canceled: message.params.canceled || false,
          blocked: message.params.blockedReason || null,
        });
      }
      if (message.method === 'Network.responseReceived') {
        const response = message.params.response || {};
        if (response.status >= 400) {
          badStatuses.push({
            status: response.status,
            url: String(response.url || '').slice(0, 180),
          });
        }
      }
    });
    await command(socket, 'Network.enable');
    await command(socket, 'Page.enable');
    await command(socket, 'Page.reload', { ignoreCache: false });
    await sleep(seconds * 1000);
    console.log(`window: ${seconds}s`);
    console.log('failed requests:');
    console.log(JSON.stringify(failures.slice(0, 30), null, 2));
    console.log('4xx/5xx responses:');
    console.log(JSON.stringify(badStatuses.slice(0, 30), null, 2));
  } finally {
    socket.close();
  }
}

async function cmdConsole(rawArgs, match) {
  const seconds = Number(rawArgs[0]) > 0 ? Number(rawArgs[0]) : 10;
  const target = pickTarget(await getTargets(), match);
  const socket = await openTarget(target);
  const events = [];
  try {
    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        events.push({
          type: message.params.type,
          text: (message.params.args || [])
            .map((arg) => String(arg.value ?? arg.description ?? ''))
            .join(' ')
            .slice(0, 300),
        });
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails || {};
        events.push({
          type: 'exception',
          text: String(details.exception?.description || details.text || '').slice(0, 300),
        });
      }
      if (message.method === 'Log.entryAdded') {
        events.push({
          type: message.params.entry.level,
          text: String(message.params.entry.text || '').slice(0, 300),
        });
      }
    });
    await command(socket, 'Runtime.enable');
    await command(socket, 'Log.enable');
    console.log(`listening ${seconds}s on ${target.url}`);
    await sleep(seconds * 1000);
    console.log(JSON.stringify(events.slice(-80), null, 2));
  } finally {
    socket.close();
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const { args, match } = parseArgs(rest);

switch (cmd) {
  case 'targets':
    await cmdTargets(args);
    break;
  case 'eval':
    await cmdEval(args, match);
    break;
  case 'reload':
    await cmdReload(args, match);
    break;
  case 'navigate':
    await cmdNavigate(args, match);
    break;
  case 'net':
    await cmdNet(args, match);
    break;
  case 'console':
    await cmdConsole(args, match);
    break;
  case undefined:
  case 'help':
  case '-h':
  case '--help':
    console.log(
      [
        'Usage:',
        '  node scripts/dev/cdp.mjs targets [url-or-title-substring]',
        '  node scripts/dev/cdp.mjs eval "<js expression>" [--match <substring>]',
        '  node scripts/dev/cdp.mjs reload [--match <substring>]',
        '  node scripts/dev/cdp.mjs navigate <url> [--match <substring>]',
        '  node scripts/dev/cdp.mjs net [seconds] [--match <substring>]',
        '  node scripts/dev/cdp.mjs console [seconds] [--match <substring>]',
        '',
        'Run `bash scripts/dev/device.sh forward` first.',
      ].join('\n')
    );
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
}
