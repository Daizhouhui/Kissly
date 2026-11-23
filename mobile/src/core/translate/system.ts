import {
  isSystemTranslationAvailable,
  prepareSystemTranslation,
  systemTranslate,
} from '../../../modules/kissly-system-translate';
import { withTimeout } from '../http';
import { getSettings } from '../store';
import {
  assertSystemLanguageSupported,
  resolveSystemSource,
} from './language';

export { isSystemTranslationAvailable };

/** On-device ML Kit translation (Android + iOS). */
export async function systemTranslateTexts(
  texts: string[],
  from: string,
  to: string,
  timeoutMs: number
): Promise<string[]> {
  if (!texts.length) return [];
  const settings = getSettings();
  const source = assertSystemLanguageSupported(
    resolveSystemSource(from, settings.learningLang),
    '原文'
  );
  const target = assertSystemLanguageSupported(to, '译文');
  // The user may enable system translation and later change the learning or
  // target language. Download the pack for the current pair instead of failing
  // with a missing-model error. Auto never selects `system`, so this cannot
  // pull a large pack during a silent free-provider fallback.
  await withTimeout(
    prepareSystemTranslation(source, target),
    timeoutMs,
    '系统翻译模型准备超时'
  );
  return withTimeout(
    systemTranslate(texts, source, target),
    timeoutMs,
    '系统翻译超时'
  );
}

export async function prepareSystemLanguagePack(from: string, to: string) {
  const settings = getSettings();
  const source = assertSystemLanguageSupported(
    resolveSystemSource(from, settings.learningLang),
    '原文'
  );
  const target = assertSystemLanguageSupported(to, '译文');
  await prepareSystemTranslation(source, target);
}
