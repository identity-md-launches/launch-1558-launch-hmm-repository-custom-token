/** Public RPC endpoints often serve logs only for recent blocks ("archive requests require a token", "pruned",
 * "missing trie node", ranges "not supported on free plan"). Such errors mean "history ends here", not "retry". */
export function isHistoryLimit(error: unknown): boolean {
  const e = error as { details?: string; shortMessage?: string; message?: string } | null
  const text = `${e?.details ?? ''} ${e?.shortMessage ?? ''} ${e?.message ?? ''}`
  return /archive|personal token|pruned|missing trie|history|not available|too old|free plan|beyond (the )?(current )?head|block range/i.test(text)
}

/** How far back most public endpoints still serve logs (publicnode: ~10k blocks). */
export const RECENT_LOG_WINDOW = 8_000n
