import {
  isSystemTranslationAvailable,
  prepareSystemTranslation,
  systemTranslate,
} from '../../../modules/kissly-system-translate';
import { getSettings } from '../store';
import { resolveSystemSource } from './language';

export { isSystemTranslationAvailable };

/** On-device ML Kit translation (Android + iOS). */
export async function systemTranslateTexts(
  texts: string[],
  from: string,
  to: string,
  _timeoutMs: number
): Promise<string[]> {
  if (!texts.length) return [];
  const settings = getSettings();
  const source = resolveSystemSource(from, settings.learningLang);
  return systemTranslate(texts, source, to);
}

export async function prepareSystemLanguagePack(from: string, to: string) {
  const settings = getSettings();
  const source = resolveSystemSource(from, settings.learningLang);
  await prepareSystemTranslation(source, to);
}
