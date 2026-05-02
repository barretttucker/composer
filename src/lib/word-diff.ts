/**
 * Lightweight word/token diff for light-mode UI (no external dependency).
 * Tokenizes on whitespace boundaries, LCS alignment for display.
 */
export type WordDiffPart = { kind: "same" | "removed" | "added"; text: string };

function tokenize(s: string): string[] {
  if (s === "") return [];
  return s.split(/(\s+)/).filter((x) => x.length > 0);
}

function mergeAdjacent(parts: WordDiffPart[]): WordDiffPart[] {
  const out: WordDiffPart[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.kind === p.kind) {
      last.text += p.text;
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

/** Returns ordered diff parts to render (prev vs next). */
export function diffWords(prev: string, next: string): WordDiffPart[] {
  const a = tokenize(prev);
  const b = tokenize(next);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] ? 1 + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const raw: WordDiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      raw.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (j < m && (i === n || dp[i + 1]![j]! >= dp[i]![j + 1]!)) {
      raw.push({ kind: "added", text: b[j]! });
      j++;
    } else if (i < n) {
      raw.push({ kind: "removed", text: a[i]! });
      i++;
    }
  }
  return mergeAdjacent(raw);
}
