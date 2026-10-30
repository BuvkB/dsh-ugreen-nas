#!/usr/bin/env node
/**
 * Merge one or more catalog JSON files produced by extract-descriptors.go into
 * lib/catalog.json. Later files win for duplicate messages/services; duplicate
 * file names are deduped.
 *
 * Usage:
 *   node scripts/build-catalog.mjs lib/catalog-filemgr.json lib/catalog-storage.json ...
 *   node scripts/build-catalog.mjs        # default set below
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const defaults = [
  'catalog-filemgr.json',
  'catalog-storage_serv.json',
  'catalog-taskmgr_serv.json',
  'catalog-docker_serv.json',
  'catalog-download_serv.json',
].map((name) => join(root, 'lib', name))
const inputs = process.argv.slice(2).length ? process.argv.slice(2) : defaults
const files = inputs.map((file) => resolve(file)).filter((file) => existsSync(file))
if (!files.length) {
  console.error('build-catalog: no input catalogs found; run extract-descriptors.go first')
  process.exit(1)
}
const out = { files: [], messages: {}, enums: {}, services: {} }
for (const file of files) {
  const catalog = JSON.parse(readFileSync(file, 'utf8'))
  for (const name of catalog.files || []) if (!out.files.includes(name)) out.files.push(name)
  Object.assign(out.messages, catalog.messages || {})
  Object.assign(out.enums, catalog.enums || {})
  Object.assign(out.services, catalog.services || {})
}
out.files.sort()
writeFileSync(join(root, 'lib', 'catalog.json'), JSON.stringify(out, null, 2))
console.log(`build-catalog: merged ${files.length} files -> lib/catalog.json (${Object.keys(out.messages).length} messages, ${Object.keys(out.services).length} services)`)
