import * as SecureStore from 'expo-secure-store';

export type SecretName =
  | 'deepseek'
  | 'siliconflow'
  | 'openrouter'
  | 'openai'
  | 'webdavPassword'
  | `openaiProfile:${string}`;

const PREFIX = 'kissmobile.secret.';

export function openaiProfileSecretName(id: string): SecretName {
  return `openaiProfile:${id}`;
}

export async function getSecret(name: SecretName): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(PREFIX + name)) ?? '';
  } catch {
    return '';
  }
}

export async function setSecret(name: SecretName, value: string): Promise<void> {
  if (value) await SecureStore.setItemAsync(PREFIX + name, value);
  else await SecureStore.deleteItemAsync(PREFIX + name);
}

export async function getAllSecrets(): Promise<Record<SecretName, string>> {
  const names: SecretName[] = [
    'deepseek',
    'siliconflow',
    'openrouter',
    'openai',
    'webdavPassword',
  ];
  const entries = await Promise.all(
    names.map(async (name) => [name, await getSecret(name)] as const)
  );
  return Object.fromEntries(entries) as Record<SecretName, string>;
}
