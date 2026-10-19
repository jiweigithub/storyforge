import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { AUTHORING_FEATURE_ENTRIES, canonicalAuthoringFeatureModule } from '../../src/lib/workspace/feature-entry-registry'
it('能力 ID 和规范实现唯一，兼容地址解析到相同工作区', () => {
  expect(new Set(AUTHORING_FEATURE_ENTRIES.map(entry => entry.id)).size).toBe(AUTHORING_FEATURE_ENTRIES.length)
  for (const entry of AUTHORING_FEATURE_ENTRIES) {
    expect(existsSync(resolve(entry.implementation))).toBe(true)
    expect(entry.owner.length).toBeGreaterThan(0); expect(entry.migration.length).toBeGreaterThan(0)
    for (const alias of entry.aliases) expect(canonicalAuthoringFeatureModule(alias)).toBe(entry.canonicalModule)
  }
  expect(canonicalAuthoringFeatureModule('geography')).toBe('locations')
  expect(canonicalAuthoringFeatureModule('world-map')).toBe('locations')
})
it('旧入口不能重新引入替换写入、模型对话或实验采纳旁路', () => {
  const read = (path: string) => readFileSync(resolve(path), 'utf8')
  const replacement = read('src/components/tools/GlobalReplacePanel.tsx')
  expect(replacement).toContain('FindReplacePanel'); expect(replacement).not.toMatch(/updateChapter|updateEntry|saveWorldview|\.replace\(/)
  expect(read('src/components/editor/SettingLookupPanel.tsx')).not.toMatch(/streamRegisteredAIEntryV1|executeRegisteredAIEntryV1|addEntry|updateEntry|localStorage/)
  expect(read('src/components/settings/prompt/WorkflowRunner.tsx')).not.toMatch(/import.*registry\/adopt|handleSaveTarget|db\./)
})
