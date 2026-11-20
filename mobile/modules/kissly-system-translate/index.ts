import { requireNativeModule } from 'expo-modules-core';

type NativeSystemTranslate = {
  prepare(from: string, to: string): Promise<boolean>;
  translate(texts: string[], from: string, to: string): Promise<string[]>;
};

let native: NativeSystemTranslate | null = null;
try {
  native = requireNativeModule<NativeSystemTranslate>('KisslySystemTranslate');
} catch {
  native = null;
}

export function isSystemTranslationSupported() {
  return !!native;
}

export async function prepareSystemTranslation(from: string, to: string) {
  if (!native) throw new Error('系统内置翻译暂不可用');
  return native.prepare(from, to);
}

export async function systemTranslate(
  texts: string[],
  from: string,
  to: string
) {
  if (!native) throw new Error('系统内置翻译暂不可用');
  return native.translate(texts, from, to);
}
