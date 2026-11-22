import { Settings } from './types';

export const KOOFIR_WEBDAV_URL = 'https://app.koofr.net/dav/Koofr';
export const WEBDAV_FOLDER = 'Kissly';

export const DEFAULT_SETTINGS: Settings = {
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  learningLang: 'en',
  interfaceLang: 'zh-CN',
  provider: 'auto',
  autoFallbackDeepSeek: true,
  autoFreeOrder: ['microsoft', 'google', 'google2'],
  autoPaidOrder: ['deepseek', 'siliconflow', 'openai'],
  translateTitles: true,
  titleTranslationMode: 'bilingual',
  defaultTab: 'video',
  discoverLayout: 'grid',
  theme: 'system',
  themeAccent: 'sage',
  keepAwake: true,
  speechRate: 0.9,
  speechPitch: 1,
  designVersion: 3,
  subtitle: {
    fontSize: 20,
    landscapeFontSize: 24,
    mode: 'bilingual',
    position: 'bottom',
    backgroundOpacity: 0.55,
    showOnVideo: true,
    transcript: true,
    scrollMode: 'top',
    sentenceMode: 'smart',
    originalFont: 'default',
    translationFont: 'default',
    originalWeight: 'medium',
    translationWeight: 'regular',
    autoNext: true,
    hideVideo: false,
    hideTitle: true,
    repeatCount: 2,
    repeatInterval: 1,
    originalTiming: 'always',
    listeningOriginalMode: 'after',
    listeningTranslationMode: 'together',
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
  system: '系统内置（离线语言包）',
  microsoft: '微软翻译（免费）',
  google: '谷歌翻译（免费）',
  google2: 'Google 备用（公共预设）',
  deepseek: 'DeepSeek',
  siliconflow: 'SiliconFlow',
  openai: 'OpenAI 兼容',
};

export const PROVIDER_HINTS: Record<string, string> = {
  auto: '自动模式先查已缓存字幕；没有缓存时按你设置的免费顺序尝试，全部失败后再按付费顺序尝试。',
  system:
    '调用手机系统自带的离线翻译。Android 需要 Google Play 服务，首次使用需下载语言包（每种约 30 MB），下载后不联网也能翻译。',
  microsoft: 'Edge 的内部免费接口，无需 Key，适合批量字幕，偶发限流。',
  google: '谷歌免费网页接口，无需 Key，国内需要代理。',
  google2:
    'Kiss Translator 内置的公共 Google 备用预设，自动链的最后备用，也可手动选择；共享 key 可能限流或失效。',
  deepseek: '按 token 计费，质量最好，需要 API Key。',
  siliconflow: '需要 API Key，可选免费模型，适合国内网络。',
  openai: '任意 OpenAI 兼容服务，自填 Base URL、模型和 Key。',
};
