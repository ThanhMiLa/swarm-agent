export interface HeaderLevel {
  showFolderPath: boolean
  showShellLabel: boolean
}

export function resolveHeaderLevel(widthPx: number): HeaderLevel {
  return { showFolderPath: widthPx >= 180, showShellLabel: widthPx >= 220 }
}

/** Compact folder label for the header — the trailing path segment only. */
export function shortenPath(path: string): string {
  const parts = path.split(/[/\\]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
