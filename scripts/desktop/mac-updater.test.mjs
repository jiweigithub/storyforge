import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMacUpdater, selectMacUpdate } from './mac-updater.mjs'
const bytes = Buffer.from('installer fixture')
const name = 'StoryForge-4.0.3-macos-arm64.dmg'
const asset = { name, size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), browser_download_url: `https://github.com/yuanbw2025/storyforge/releases/download/v4.0.3/${name}` }
const release = { tag_name: 'v4.0.3', assets: [asset] }
test('macOS updates require stable, increasing versions and the exact architecture, origin and digest', () => {
  assert.equal(selectMacUpdate(release, '4.0.2', 'arm64').version, '4.0.3')
  for (const current of ['4.0.3', '4.1.0', '5.0.0']) assert.equal(selectMacUpdate(release, current, 'arm64'), null)
  assert.equal(selectMacUpdate({ ...release, prerelease: true }, '4.0.2', 'arm64'), null)
  assert.throws(() => selectMacUpdate(release, '4.0.2', 'x64'))
  for (const patch of [{ digest: null }, { browser_download_url: 'https://example.com/app.dmg' }, { size: 3 * 1024 ** 3 }]) {
    assert.throws(() => selectMacUpdate({ ...release, assets: [{ ...asset, ...patch }] }, '4.0.2', 'arm64'))
  }
})
test('macOS download is verified before opening; corruption or changed files cannot install', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sf-mac-update-'))
  try {
    const opened = [], events = []
    let body = bytes
    const updater = createMacUpdater({ app: { getPath: () => dir, getVersion: () => '4.0.2' }, arch: 'arm64', shell: { openPath: async path => { opened.push(path); return '' } }, fetchImpl: async url => url.includes('api.github.com') ? Response.json(release) : new Response(body) })
    updater.on('error', () => events.push('error'))
    updater.on('update-downloaded', () => events.push('ready'))
    await assert.rejects(updater.openInstaller)
    await updater.checkForUpdates()
    body = Buffer.from('corrupt')
    await assert.rejects(updater.downloadUpdate)
    await assert.rejects(updater.openInstaller)
    assert.deepEqual(opened, [])
    body = bytes
    await updater.downloadUpdate()
    assert.deepEqual(events, ['error', 'ready'])
    assert.deepEqual(opened, [])
    await updater.openInstaller()
    assert.equal(opened.length, 1)
    await writeFile(join(dir, 'updates', name), 'tampered')
    await assert.rejects(updater.openInstaller)
    assert.equal(opened.length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
