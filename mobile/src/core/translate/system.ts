import {
  isSystemTranslationAvailable,
  prepareSystemTranslation,
  systemTranslate,
} from '../../../modules/kissly-system-translate';

export { isSystemTranslationAvailable };

/** On-device ML Kit translation (Android + iOS). */
export async function systemTranslateTexts(
  texts: string[],
  from: string,
  to: string,
  _timeoutMs: number
): Promise<string[]> {
  if (!texts.length) return [];
  const source = from === 'auto' ? 'en' : from;
  return systemTranslate(texts, source, to);
}

export async function prepareSystemLanguagePack(from: string, to: string) {
  const source = from === 'auto' ? 'en' : from;
  await prepareSystemTranslation(source, to);
}
