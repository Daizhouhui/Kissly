import type { WebDavConfig } from '../types';

function utf8ToBase64(value: string): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      const point = 0x10000 + ((code & 0x3ff) << 10) + (next & 0x3ff);
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f)
      );
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triplet = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    output += chars[(triplet >> 18) & 63];
    output += chars[(triplet >> 12) & 63];
    output += b === undefined ? '=' : chars[(triplet >> 6) & 63];
    output += c === undefined ? '=' : chars[triplet & 63];
  }
  return output;
}

export function encodeWebdavPath(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function buildWebdavUrl(
  base: string,
  folder: string,
  path = ''
): string {
  const root = base.replace(/\/+$/, '');
  const folderPath = encodeWebdavPath(
    (folder || 'Kissly').replace(/^\/+|\/+$/g, '')
  );
  const clean = path.replace(/^\/+/, '');
  return clean
    ? `${root}/${folderPath}/${encodeWebdavPath(clean)}`
    : `${root}/${folderPath}`;
}

export class WebdavClient {
  private base: string;
  private auth: string;
  private folder: string;

  constructor(config: WebDavConfig) {
    this.base = config.url.replace(/\/+$/, '');
    this.folder = (config.folder || 'Kissly').replace(/^\/+|\/+$/g, '');
    this.auth = `Basic ${utf8ToBase64(`${config.username}:${config.password}`)}`;
  }

  private url(path: string): string {
    return buildWebdavUrl(this.base, this.folder, path);
  }

  private folderUrl(): string {
    return buildWebdavUrl(this.base, this.folder);
  }

  private async request(
    method: string,
    url: string,
    body?: string,
    extraHeaders?: Record<string, string>
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: this.auth,
          ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
          ...(extraHeaders ?? {}),
        },
        body,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if ((error as any)?.name === 'AbortError') {
        throw new Error('WebDAV 请求超时，请检查网络或服务器地址');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async ensureFolder(): Promise<void> {
    const parts = this.folder
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    // WebDAV has no recursive MKCOL. A folder like "Backups/Kissly" needs its
    // parent created first, otherwise the server answers 409 forever.
    for (let index = 0; index < parts.length; index += 1) {
      const folderPath = parts.slice(0, index + 1).join('/');
      const response = await this.request(
        'MKCOL',
        buildWebdavUrl(this.base, folderPath)
      );
      if ([201, 200, 204, 301, 405].includes(response.status)) continue;
      if (response.status === 401 || response.status === 403) {
        throw new Error('WebDAV 认证失败，请检查用户名和应用密码');
      }
      throw new Error(`WebDAV 创建目录失败 (${response.status})`);
    }
  }

  async test(): Promise<void> {
    const response = await this.request('PROPFIND', this.folderUrl(), undefined, {
      Depth: '0',
    });
    if (response.status === 207 || response.status === 200) return;
    if (response.status === 404) {
      await this.ensureFolder();
      return;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('WebDAV 认证失败，请检查用户名和应用密码');
    }
    throw new Error(`WebDAV 连接失败 (${response.status})`);
  }

  async getJson<T>(path: string): Promise<{ data: T | null; etag: string }> {
    const response = await this.request('GET', this.url(path), undefined, {
      Accept: 'application/json',
    });
    if (response.status === 404) return { data: null, etag: '' };
    if (response.status === 401 || response.status === 403) {
      throw new Error('WebDAV 认证失败');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`WebDAV 读取失败 (${response.status})`);
    }
    const text = await response.text();
    if (!text.trim()) return { data: null, etag: response.headers.get('etag') ?? '' };
    try {
      return {
        data: JSON.parse(text) as T,
        etag: response.headers.get('etag') ?? '',
      };
    } catch {
      return { data: null, etag: response.headers.get('etag') ?? '' };
    }
  }

  async putJson(path: string, data: unknown, etag?: string): Promise<string> {
    const response = await this.request(
      'PUT',
      this.url(path),
      JSON.stringify(data),
      etag ? { 'If-Match': etag } : undefined
    );
    if (response.status === 412) {
      throw new Error('WebDAV 文件已被其他设备修改，请重新同步');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('WebDAV 认证失败');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`WebDAV 写入失败 (${response.status})`);
    }
    return response.headers.get('etag') ?? '';
  }
}
