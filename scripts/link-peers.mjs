#!/usr/bin/env node
/**
 * Link the optional DSH peer packages into node_modules for tests and builds.
 *
 * The peers are provided by the running DSH installation, so a plain
 * `npm install` never brings them in, and a manually linked copy goes stale
 * whenever DSH updates. `npm test` and `scripts/build.sh` run this first so
 * the links always follow the live installation.
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = os.homedir()
const dshHome = process.env.DSH_HOME || join(home, '.dsh')
const CANDIDATES = [
  join(dshHome, 'profiles/web/node_modules'),
  join(dshHome, 'profiles/node_modules'),
  join(home, '.dsh-runtime/lib/node_modules/@deepseek-ai/dsh/node_modules'),
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules',
]
const PEERS = ['@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-typert-protocol']

const depRoot = CANDIDATES.find((candidate) => PEERS.every((pkg) => existsSync(join(candidate, pkg))))
if (!depRoot) {
  console.warn('link-peers: 未找到包含 DSH peer 的目录；需要 peer 的测试将跳过')
  process.exit(0)
}
for (const pkg of PEERS) {
  const link = join(root, 'node_modules', pkg)
  const target = join(depRoot, pkg)
  if (!existsSync(target)) continue
  rmSync(link, { recursive: true, force: true })
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(resolve(target), resolve(link), process.platform === 'win32' ? 'junction' : 'dir')
  console.log('link-peers: ' + pkg + ' -> ' + target)
}
