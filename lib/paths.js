/**
 * Directory whitelist for UGREEN NAS tools.
 *
 * The NAS access-token permission model is account-wide: a Files read grant
 * can read every file that account can see. The connector therefore adds its
 * own allow-list on top, so a deployment can limit the model to selected
 * shares/directories even when the token itself is broader.
 */
import path from 'node:path'

/** Normalize a Config value (array or multiline/comma string) into POSIX roots. */
export function normalizeAllowedRoots(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n|,/)
  const roots = []
  for (const item of raw) {
    const value = String(item ?? '').trim()
    if (!value) continue
    if (!value.startsWith('/')) throw new Error(`目录白名单必须是绝对路径：${value}`)
    if (value.includes('\0')) throw new Error('目录白名单包含非法字符')
    const normalized = path.posix.normalize(value).replace(/\/+$/, '') || '/'
    if (!roots.includes(normalized)) roots.push(normalized)
  }
  return roots
}

/** True when candidate is an absolute POSIX path inside one of roots. */
export function isPathAllowed(candidate, roots = []) {
  if (!Array.isArray(roots) || roots.length === 0) return true
  const raw = String(candidate ?? '').trim()
  if (!raw || !raw.startsWith('/') || raw.includes('\0')) return false
  const normalized = path.posix.normalize(raw)
  return roots.some((root) => {
    if (root === '/') return true
    return normalized === root || normalized.startsWith(`${root}/`)
  })
}

/** Throw a stable, model-readable error when a path is outside the allow-list. */
export function assertPathAllowed(candidate, roots = [], label = '路径') {
  if (isPathAllowed(candidate, roots)) return
  throw new Error(`${label}不在插件允许的目录白名单内：${String(candidate ?? '')}。请在插件设置中调整「目录白名单」。`)
}
