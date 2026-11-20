import { Settings } from './types';

export const KOOFIR_WEBDAV_URL = 'https://app.koofr.net/dav/Koofr';
export const WEBDAV_FOLDER = 'Kissly';

export const DEFAULT_SETTINGS: Settings = {
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  provider: 'auto',
  autoFallbackDeepSeek: true,
  translateTitles: true,
  discoverLayout: 'list',
  theme: 'system',
  themeAccent: 'blue',
  subtitle: {
    fontSize: 20,
    mode: 'bilingual',
    position: 'bottom',
    backgroundOpacity: 0.55,
    showOnVideo: true,
    transcript: true,
  },
  webdav: {
    url: KOOFIR_WEBDAV_URL,
    username: '',
    password: '',
    enabled: false,
    folder: WEBDAV_FOLDER,
  },
  deepseekModel: 'deepseek-chat',
  siliconflowModel: 'Qwen/Qwen3.5-9B',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  requestTimeoutMs: 20000,
};

export const TARGET_LANGUAGES = [
  { code: 'zh-CN', label: '简体中文', microsoft: 'zh-Hans', google: 'zh-CN' },
  { code: 'zh-TW', label: '繁體中文', microsoft: 'zh-Hant', google: 'zh-TW' },
  { code: 'en', label: 'English', microsoft: 'en', google: 'en' },
  { code: 'ja', label: '日本語', microsoft: 'ja', google: 'ja' },
  { code: 'ko', label: '한국어', microsoft: 'ko', google: 'ko' },
  { code: 'es', label: 'Español', microsoft: 'es', google: 'es' },
  { code: 'fr', label: 'Français', microsoft: 'fr', google: 'fr' },
  { code: 'de', label: 'Deutsch', microsoft: 'de', google: 'de' },
] as const;

export function targetLabel(code: string) {
  return TARGET_LANGUAGES.find((item) => item.code === code)?.label ?? code;
}

export function microsoftTarget(code: string) {
  return TARGET_LANGUAGES.find((item) => item.code === code)?.microsoft ?? code;
}

export function googleTarget(code: string) {
  return TARGET_LANGUAGES.find((item) => item.code === code)?.google ?? code;
}

export const PROVIDER_LABELS: Record<string, string> = {
  auto: '自动（免费优先）',
  microsoft: '微软翻译（免费）',
  google: '谷歌翻译（免费）',
  google2: 'Google2 备用（公共预设）',
  deepseek: 'DeepSeek',
  siliconflow: 'SiliconFlow',
  openai: 'OpenAI 兼容',
};

export const PROVIDER_HINTS: Record<string, string> = {
  auto: '先走微软免费接口，失败后切谷歌免费，再失败自动用 DeepSeek（需填 Key）。',
  microsoft: 'Edge 的内部免费接口，无需 Key，适合批量字幕，偶发限流。',
  google: '谷歌免费网页接口，无需 Key，国内需要代理。',
  google2:
    'Kiss Translator 内置的公共 Google2 预设，适合批量字幕；共享 key 可能限流或失效，作为备用源。',
  deepseek: '按 token 计费，质量最好，需要 API Key。',
  siliconflow: '需要 API Key，可选免费模型，适合国内网络。',
  openai: '任意 OpenAI 兼容服务，自填 Base URL、模型和 Key。',
};
