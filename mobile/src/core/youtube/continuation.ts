export type ContinuationKind = 'legacy' | 'modern';

export type ContinuationCandidate = {
  token: string;
  path: readonly string[];
  kind: ContinuationKind;
};

/**
 * Read a continuation token from both the legacy renderer shape and the newer
 * view-model shape:
 *
 * legacy:
 *   continuationItemRenderer.continuationEndpoint.continuationCommand.token
 * modern:
 *   continuationItemViewModel.continuationCommand.innertubeCommand
 *     .continuationCommand.token
 */
export function readContinuation(
  node: any
): { token: string; kind: ContinuationKind } | undefined {
  const legacy =
    node?.continuationItemRenderer?.continuationEndpoint?.continuationCommand
      ?.token;
  if (typeof legacy === 'string' && legacy) {
    return { token: legacy, kind: 'legacy' };
  }

  const modern =
    node?.continuationItemViewModel?.continuationCommand?.innertubeCommand
      ?.continuationCommand?.token ??
    node?.continuationItemViewModel?.continuationCommand?.token;
  if (typeof modern === 'string' && modern) {
    return { token: modern, kind: 'modern' };
  }

  return undefined;
}

/**
 * The first page contains continuation tokens for the video grid, the header
 * filter chips and the description panel. Only the token inside the main
 * content list can fetch more videos, so rank by path instead of taking the
 * last token encountered.
 */
export function scoreContinuationPath(path: readonly string[]): number {
  const joined = path.join('/');
  if (!joined) return 0;
  if (joined.includes('header') || joined.includes('engagementPanel')) return 0;
  if (/richGridRenderer\/contents(\/|$)/.test(joined)) return 100;
  if (/playlistVideoListRenderer\/contents(\/|$)/.test(joined)) return 100;
  if (/gridRenderer\/contents(\/|$)/.test(joined)) return 90;
  if (/itemSectionRenderer\/contents(\/|$)/.test(joined)) return 80;
  return 10;
}

export function pickContinuationToken(
  candidates: readonly ContinuationCandidate[]
): string | undefined {
  let best: ContinuationCandidate | undefined;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = scoreContinuationPath(candidate.path);
    if (score <= 0) continue;
    if (
      !best ||
      score > bestScore ||
      (score === bestScore && candidate.token.length > best.token.length)
    ) {
      best = candidate;
      bestScore = score;
    }
  }

  return best?.token;
}

/** Walk the browse response and pick the continuation that belongs to the
 * main video/playlist list. */
export function chooseContinuationToken(data: any): string | undefined {
  const candidates: ContinuationCandidate[] = [];
  const visit = (node: any, path: string[] = [], depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 60) return;
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, [...path, `[${index}]`], depth + 1));
      return;
    }

    const continuation = readContinuation(node);
    if (continuation) {
      candidates.push({ ...continuation, path });
    }

    for (const key of Object.keys(node)) {
      if (key === 'continuationCommand') continue;
      visit(node[key], [...path, key], depth + 1);
    }
  };
  visit(data);
  return pickContinuationToken(candidates);
}
