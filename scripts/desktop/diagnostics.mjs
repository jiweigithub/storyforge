import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const names = new Set(['NativeCrash', 'NativeOutOfMemory', 'NativeUnresponsive', 'NativeInterrupted'])
export function desktopDiagnostics(directory, build) {
  const path = join(directory, 'native-diagnostics.json')
  const read = () => {
    try {
      if (statSync(path).size > 8192) return { running: false, errors: [] }
      const value = JSON.parse(readFileSync(path, 'utf8'))
      const errors = Array.isArray(value.errors) ? value.errors.slice(-5).filter(row => names.has(row.name) && Number.isFinite(Date.parse(row.occurredAt)) && Date.parse(row.occurredAt) >= Date.now() - 7 * 86400000 && Date.parse(row.occurredAt) <= Date.now() + 300000).map(row => ({ source: 'native', name: row.name, occurredAt: new Date(row.occurredAt).toISOString(), frames: [], build: /^v\d+\.\d+\.\d+\+local$/.test(row.build) ? row.build : 'unknown' })) : []
      return { running: value.running === true, errors }
    } catch { return { running: false, errors: [] } }
  }
  const write = value => { try { mkdirSync(directory, { recursive: true, mode: 0o700 }); writeFileSync(path + '.tmp', JSON.stringify(value), { mode: 0o600 }); renameSync(path + '.tmp', path) } catch { /* Best effort diagnostics. */ } }
  const record = name => {
    if (!names.has(name)) return
    const value = read()
    value.errors = [...value.errors, { source: 'native', name, occurredAt: new Date().toISOString(), frames: [], build }].slice(-5)
    write(value)
  }
  return {
    start() { const previous = read(); if (previous.running) record('NativeInterrupted'); write({ ...read(), running: true }) },
    cleanExit() { write({ ...read(), running: false }) },
    record,
    read: () => read().errors,
  }
}
