import * as FileSystem from 'expo-file-system/legacy';

const UPDATE_CACHE_FOLDER = 'updates';

function cacheRoot(): string | null {
  const root = FileSystem.cacheDirectory;
  if (!root) return null;
  return root.endsWith('/') ? root : `${root}/`;
}

/**
 * APKs are downloaded here instead of the cache root, so a cold start can
 * remove every update artifact without touching unrelated cache files.
 */
export function updateCacheDirectory(): string | null {
  const root = cacheRoot();
  return root ? `${root}${UPDATE_CACHE_FOLDER}/` : null;
}

export async function ensureUpdateCacheDirectory(): Promise<string | null> {
  const directory = updateCacheDirectory();
  if (!directory) return null;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  return directory;
}

export function safeUpdateFileName(fileName: string, version: string): string {
  const source = fileName.trim() || `kissly-${version}.apk`;
  return source.replace(/[\\/]/g, '-');
}

/**
 * The installer reads the APK through a content URI after this screen returns,
 * so deleting it immediately can break an install. Cleanup is deferred until
 * the next cold start of the app instead.
 */
export async function clearUpdateCache(): Promise<number> {
  const root = cacheRoot();
  if (!root) return 0;

  let removed = 0;
  const directory = `${root}${UPDATE_CACHE_FOLDER}/`;
  try {
    const info = await FileSystem.getInfoAsync(directory);
    if (info.exists) {
      await FileSystem.deleteAsync(directory, { idempotent: true });
      removed += 1;
    }
  } catch {
    // Cache cleanup must never block startup.
  }

  // Older builds wrote kissly-*.apk directly into the cache root. Sweep only
  // APKs there; everything else in the app cache is left untouched.
  try {
    const entries = await FileSystem.readDirectoryAsync(root);
    const apkNames = entries.filter((name) => name.toLowerCase().endsWith('.apk'));
    await Promise.all(
      apkNames.map(async (name) => {
        try {
          await FileSystem.deleteAsync(`${root}${name}`, { idempotent: true });
          removed += 1;
        } catch {
          // Ignore a single locked or already removed file.
        }
      })
    );
  } catch {
    // The cache root may not exist on a fresh install.
  }

  return removed;
}
