import { afterEach, expect, it, vi } from 'vitest'
const files = vi.hoisted(() => ({
  begin: vi.fn(async () => ({ id: 'temporary-export' })), append: vi.fn(async () => {}),
  save: vi.fn(async () => {}), discard: vi.fn(async () => {}),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android' }, registerPlugin: () => files }))
import { saveFile } from '../../src/lib/platform/save-file'
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
it('Android save resolves only after the system file write receipt', async () => {
  vi.stubEnv('MODE', 'android')
  let finish!: () => void
  files.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let resolved = false
  const saving = saveFile(new Blob(['中文 manuscript'], { type: 'application/json' }), 'backup.json').then(() => { resolved = true })
  await vi.waitFor(() => expect(files.save).toHaveBeenCalled())
  expect(resolved).toBe(false)
  expect(files.discard).not.toHaveBeenCalled()
  finish(); await saving
  expect(files.discard).toHaveBeenCalledWith({ id: 'temporary-export' })
})
it('cancel or failed native save rejects, so backup-dependent mutations cannot proceed', async () => {
  vi.stubEnv('MODE', 'android')
  files.save.mockRejectedValueOnce(new Error('cancelled'))
  await expect(saveFile(new Blob(['manuscript']), 'backup.json')).rejects.toThrow('cancelled')
  expect(files.discard).toHaveBeenCalled()
})
