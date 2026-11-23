/* eslint-disable no-console */
/**
 * Local development-only HTTP proxy for the Expo web preview.
 *
 * It forwards requests through the user's local HTTP proxy and adds CORS
 * headers so browser-side fetch calls can reach services that do not allow
 * cross-origin requests. This file is never bundled into a release build.
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PORT = Number(process.env.DEV_PROXY_PORT || 8085);
const UPSTREAM_PROXY = process.env.DEV_UPSTREAM_PROXY || 'http://127.0.0.1:10808';
const agent = UPSTREAM_PROXY ? new HttpsProxyAgent(UPSTREAM_PROXY) : undefined;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': '*',
  'access-control-max-age': '86400',
};

function isPrivateHost(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (lower === '0.0.0.0' || lower === '::1' || lower === '[::1]') return true;
  if (/^127\./.test(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(lower)) return true;
  if (/^169\.254\./.test(lower)) return true;
  return false;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    ...CORS_HEADERS,
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (requestUrl.pathname !== '/proxy') {
    sendJson(res, 404, { error: 'Not found. Use /proxy?url=<encoded-url>' });
    return;
  }

  const target = requestUrl.searchParams.get('url');
  if (!target) {
    sendJson(res, 400, { error: 'Missing url parameter' });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    sendJson(res, 400, { error: 'Invalid url parameter' });
    return;
  }

  if (!/^https?:$/.test(targetUrl.protocol) || isPrivateHost(targetUrl.hostname)) {
    sendJson(res, 403, { error: 'Target is not allowed' });
    return;
  }

  const chunks = [];
  let bodyBytes = 0;
  req.on('data', (chunk) => {
    bodyBytes += chunk.length;
    if (bodyBytes > MAX_BODY_BYTES) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (bodyBytes > MAX_BODY_BYTES) {
      sendJson(res, 413, { error: 'Request body too large' });
      return;
    }

    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['content-length'];
    delete headers['accept-encoding'];
    delete headers.origin;
    delete headers.referer;

    headers['accept-encoding'] = 'identity';
    if (targetUrl.hostname.endsWith('youtube.com')) {
      headers.origin = 'https://www.youtube.com';
      headers.referer = 'https://www.youtube.com/';
    } else {
      headers.origin = targetUrl.origin;
      headers.referer = `${targetUrl.origin}/`;
    }

    const transport = targetUrl.protocol === 'https:' ? https : http;
    const upstream = transport.request(
      targetUrl,
      {
        method: req.method,
        headers,
        agent: targetUrl.protocol === 'https:' ? agent : undefined,
        timeout: 30000,
      },
      (upstreamRes) => {
        const responseHeaders = { ...upstreamRes.headers, ...CORS_HEADERS };
        delete responseHeaders['content-encoding'];
        delete responseHeaders['content-length'];
        delete responseHeaders['transfer-encoding'];
        res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
        upstreamRes.pipe(res);
      }
    );

    upstream.on('timeout', () => {
      upstream.destroy(new Error('Upstream request timed out'));
    });
    upstream.on('error', (error) => {
      if (!res.headersSent) {
        sendJson(res, 502, {
          error: 'Proxy request failed',
          detail: error.message,
          upstreamProxy: UPSTREAM_PROXY,
        });
      } else {
        res.destroy(error);
      }
    });

    if (body) upstream.write(body);
    upstream.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[dev-proxy] listening on http://127.0.0.1:${PORT} via ${UPSTREAM_PROXY}`
  );
});
