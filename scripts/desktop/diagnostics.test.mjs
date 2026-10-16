import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopDiagnostics } from './diagnostics.mjs'
test('native summaries are bounded, omit raw errors, and distinguish unclean exits from confirmed crashes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-native-diagnostics-'))
  try {
    const d = desktopDiagnostics(directory, 'v4.0.1+local'); d.start(); d.record('SECRET key or manuscript')
    assert.equal(d.read().length, 0)
    desktopDiagnostics(directory, 'v4.0.1+local').start()
    assert.equal(d.read()[0].name, 'NativeInterrupted')
    d.cleanExit(); d.start(); assert.equal(d.read().length, 1)
    for (let i = 0; i < 8; i++) d.record('NativeCrash')
    assert.equal(d.read().length, 5)
    assert.equal(readFileSync(join(directory, 'native-diagnostics.json'), 'utf8').includes('SECRET'), false)
    d.cleanExit()
  } finally { rmSync(directory, { recursive: true }) }
})
