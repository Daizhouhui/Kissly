export type AutoFreeProviderId = 'microsoft' | 'google' | 'google2';

export type AutoPaidProviderId =
  | 'deepseek'
  | 'siliconflow'
  | 'openrouter'
  | 'openai';

export type OpenAiProfile = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
};

export type ProviderId =
  | 'auto'
  | 'system'
  | AutoFreeProviderId
  | AutoPaidProviderId;

export type SubtitleMode = 'bilingual' | 'original' | 'translation';

export type SubtitlePosition = 'bottom' | 'top';

export type ThemePreference = 'system' | 'light' | 'dark';

export type ThemeAccent =
  | 'youtube'
  | 'sage'
  | 'violet'
  | 'blue'
  | 'teal'
  | 'orange'
  | 'rose'
  | 'green';

export type DiscoverLayout = 'list' | 'grid' | 'large';

export type TitleTranslationMode = 'none' | 'bilingual' | 'translation';

export type DefaultTab = 'video' | 'podcast' | 'learning';

export type SubtitleScrollMode = 'top' | 'page';

export type SentenceMode = 'smart' | 'whole';

export type SubtitleFont = 'default' | 'rounded' | 'serif' | 'geometric' | 'kai';

export type SubtitleWeight = 'regular' | 'normal' | 'medium' | 'bold' | 'heavy';

export type OriginalTiming = 'always' | 'after';

export type ListeningOriginalMode = 'after' | 'always' | 'tap';

export type ListeningTranslationMode = 'always' | 'together' | 'tap';

export type SubtitlePrefs = {
  /** Portrait transcript font size. */
  fontSize: number;
  /** Precision-listening card font size, independent from the transcript. */
  listeningFontSize: number;
  /** Landscape / fullscreen overlay font size, independent from portrait. */
  landscapeFontSize: number;
  mode: SubtitleMode;
  position: SubtitlePosition;
  backgroundOpacity: number;
  showOnVideo: boolean;
  transcript: boolean;
  scrollMode: SubtitleScrollMode;
  sentenceMode: SentenceMode;
  originalFont: SubtitleFont;
  translationFont: SubtitleFont;
  originalWeight: SubtitleWeight;
  translationWeight: SubtitleWeight;
  /** Blind-listening mode advances to the next sentence automatically. */
  autoNext: boolean;
  /** Listening mode hides the video and uses the whole screen for subtitles. */
  hideVideo: boolean;
  /** Player header hides the video title and channel name. */
  hideTitle: boolean;
  /** How many times a sentence is played in sentence-loop mode. */
  repeatCount: number;
  /** Pause between repeats, in seconds. */
  repeatInterval: number;
  originalTiming: OriginalTiming;
  /** When the original text appears during precision listening. */
  listeningOriginalMode: ListeningOriginalMode;
  /** When the translation appears during precision listening. */
  listeningTranslationMode: ListeningTranslationMode;
};

export type WebDavConfig = {
  url: string;
  username: string;
  password: string;
  enabled: boolean;
  folder: string;
};

/** Accent used by system speech and by non-original English audio tracks. */
export type SpeechAccent = 'en-US' | 'en-GB';

export type Settings = {
  sourceLang: string;
  targetLang: string;
  /** Language the learner is studying; also drives caption-track selection. */
  learningLang: string;
  /** Only Simplified Chinese ships today; kept for the Android-reference row. */
  interfaceLang: string;
  provider: ProviderId;
  autoFallbackDeepSeek: boolean;
  /** Auto mode tries these free engines in this order. */
  autoFreeOrder: AutoFreeProviderId[];
  /** Paid engines tried after the free chain when fallback is enabled. */
  autoPaidOrder: AutoPaidProviderId[];
  translateTitles: boolean;
  titleTranslationMode: TitleTranslationMode;
  defaultTab: DefaultTab;
  discoverLayout: DiscoverLayout;
  theme: ThemePreference;
  themeAccent: ThemeAccent;
  keepAwake: boolean;
  speechRate: number;
  speechPitch: number;
  /** Default English accent for speech preview and dub-only audio tracks. */
  speechAccent: SpeechAccent;
  /** Android-reference design migration marker. */
  designVersion: number;
  subtitle: SubtitlePrefs;
  webdav: WebDavConfig;
  deepseekModel: string;
  /** DeepSeek 思考模式；默认关闭，避免字幕翻译先写思维链导致变慢、变贵。 */
  deepseekThinking: boolean;
  siliconflowModel: string;
  openrouterModel: string;
  /** Saved OpenAI-compatible endpoints; the active one mirrors the legacy fields below. */
  openaiProfiles: OpenAiProfile[];
  openaiProfileId: string;
  openaiBaseUrl: string;
  openaiModel: string;
  requestTimeoutMs: number;
};

export type Subscription = {
  channelId: string;
  title: string;
  handle?: string;
  avatar?: string;
  group?: string;
  subscriberCount?: string;
  videoCount?: string;
  addedAt: number;
  /** Display order. Lower values come first; kept in sync across devices. */
  order?: number;
};

export type VideoItem = {
  videoId: string;
  title: string;
  translatedTitle?: string;
  channelId: string;
  channelTitle: string;
  channelAvatar?: string;
  published: number;
  thumbnail: string;
  duration?: number;
  viewCount?: number;
  isShort?: boolean;
};

export type Cue = {
  start: number;
  end: number;
  text: string;
  translation?: string;
};

export type CaptionTrack = {
  baseUrl: string;
  languageCode: string;
  name: string;
  kind?: string;
  isTranslatable?: boolean;
};

export type VideoMeta = {
  videoId: string;
  title: string;
  author: string;
  channelId?: string;
  lengthSeconds: number;
  thumbnail: string;
  captionTracks: CaptionTrack[];
  visitorData?: string;
};

export type PlayerPayload = {
  meta: Pick<VideoMeta, 'videoId' | 'title' | 'author' | 'lengthSeconds'> & {
    thumbnail?: string;
  };
  cues: Cue[];
  subtitle: SubtitlePrefs;
  theme: 'light' | 'dark';
  quality?: string;
};

export type FavoriteItem = {
  videoId: string;
  title: string;
  author: string;
  thumbnail?: string;
  savedAt: number;
  progress?: number;
  duration?: number;
};

export type HistoryItem = {
  videoId: string;
  title: string;
  author: string;
  thumbnail?: string;
  /** First time this video entered history; never rewritten. */
  savedAt: number;
  /** Last time progress was accepted; drives "最近观看". */
  lastWatchedAt: number;
  /** Furthest watched fraction, monotonic. */
  progress: number;
  /** Last playback position in seconds. */
  resumeAt?: number;
  duration?: number;
};

export type SentenceFavorite = {
  /** Stable per video + cue start time. */
  id: string;
  videoId: string;
  videoTitle: string;
  videoAuthor: string;
  thumbnail?: string;
  start: number;
  end: number;
  text: string;
  translation?: string;
  savedAt: number;
};

export type ProviderResult = {
  texts: string[];
  provider: ProviderId;
};
