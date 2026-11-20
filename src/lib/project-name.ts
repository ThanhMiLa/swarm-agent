/** Default naming for a new project: the project folder, de-duped. */

import { folderName } from '@/lib/recent-folders'

/**
 * Name a project after the last segment of `cwd`, appending ` (1)`, ` (2)`, …
 * when that name is already in use. Use "Project" if no folder was provided.
 */
export function projectNameFor(cwd: string, existingNames: string[]): string {
  const trimmed = cwd.trim()
  const base = trimmed === '' ? 'Project' : folderName(trimmed)
  const taken = new Set(existingNames)
  if (!taken.has(base)) return base
  // First free suffix, not "highest + 1": closing "myapp (1)" should let the
  // next workspace reclaim that slot instead of drifting the numbers upward.
  for (let n = 1; ; n++) {
    const candidate = `${base} (${n})`
    if (!taken.has(candidate)) return candidate
  }
}
