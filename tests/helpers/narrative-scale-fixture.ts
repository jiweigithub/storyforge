import golden from '../acceptance/narrative-world/worldrelease-v4-content-golden.json'
import plan from '../acceptance/narrative-world/scale-plan-20261015-v1.json'
import type { WorldReleaseSemanticContentV4 } from '../../src/lib/types/narrative-release'
import type { NarrativeDomainRowV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { captureFrozenNarrativeSourcesV4 } from '../../src/lib/world-engine/narrative-release-v4'
import { hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { deriveRegisteredSemanticRowsV1 } from '../../src/lib/export/registry-export'
import { hashNarrativeBytesV1, canonicalNarrativeJsonV1 } from '../../src/lib/world-engine/narrative-json'

const STAMP = 1_900_000_000_000
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const uid = (kind: string, index: number) => `res:v1:${kind}:${uuid(index)}`
const places = ['青石码头', '北窗仓库', '苇塘木屋', '东岸桥头', '西坡茶亭', '南渠闸门', '旧塔书房', '山腰驿站', '柳堤渡棚', '石阶市集', '松林小径', '空院井边', '溪口磨坊', '竹篱菜圃', '云下岗楼', '河湾船坞']
const objects = ['木桨', '竹篓', '绢帕', '纸灯', '草绳', '陶罐', '铜镜', '铁尺', '布囊', '石砚', '银簪', '玉扣', '油伞', '漆盘', '竹笛', '藤筐']
const actions = ['重新清点', '小心收起', '仔细擦拭', '交给邻人保管', '搬到阴凉处', '放在门边', '包进旧布', '带到桥下', '记入账簿', '拿到日光下查看', '移到窗台', '装入箱底', '从柜中取出', '放回架上', '晾在檐下', '送到柜台']
const weather = ['薄雾未散', '日影渐短', '潮声渐近', '雨丝将停', '晚风拂过', '云隙透光', '树影摇动', '炊烟升起', '石面仍湿', '芦叶带露', '渡船靠岸', '灯火初明', '远钟响起', '荷叶轻晃', '门环微冷', '星光初现']
function scene(index: number, length: number, early: number, late: number): string {
  let state = (index + 1) >>> 0
  const choose = <T>(values: T[]): T => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return values[Math.floor(state / 0x1_0000_0000 * values.length)] }
  let text = index === early ? plan.needles.earlyQuote : index === late ? plan.needles.lateQuote : ''
  text += `纪事${String(index + 1).padStart(5, '0')}。`
  while ([...text].length < length) {
    text += `${choose(weather)}，${choose(['陈', '林', '周', '许', '顾', '沈', '宋', '江'])}${choose(['舟', '岚', '青', '照', '川', '遥', '汀', '禾'])}在${choose(places)}${choose(actions)}${choose(objects)}。`
  }
  return [...text].slice(0, length - 1).join('') + '。'
}

/** Evaluation-only declarations, with deterministic synthetic receipt IDs.
 * No model extraction or real author confirmation is claimed. Production
 * code cannot import this helper or its corpus (the architecture gate checks). */
export async function buildNarrativeScaleInputV1(characterCount: number) {
  if (!Number.isSafeInteger(characterCount) || characterCount < 1000 || characterCount > 1_000_000) throw Error('scale character count out of range')
  const template = structuredClone(golden.compiled.manifest) as unknown as WorldReleaseSemanticContentV4
  const { narrative: _narrative, ...templateFields } = template
  const input: Omit<WorldReleaseSemanticContentV4, 'narrative'> = {
    schema: 'storyforge.world-release', version: 4, semanticContract: 4, compilerVersion: 'narrative-domain-v1', registryVersion: 'world-semantic-v4',
    worldCode: templateFields.worldCode, worldName: `规模场景 ${characterCount}`, records: { characters: [], historicalTimelineEvents: [] },
    selectedTables: ['characters', 'historicalTimelineEvents'], sourceManifest: templateFields.sourceManifest, semanticSnapshot: templateFields.semanticSnapshot,
  }
  input.semanticSnapshot.project.name = input.worldName
  input.semanticSnapshot.worlds[0].name = input.worldName
  input.semanticSnapshot.works[0].title = input.worldName
  const capture = captureFrozenNarrativeSourcesV4({ ...input, sourceWorkCode: null })
  const actorCount = 50, eventCount = Math.max(4, Math.floor(characterCount / 100))
  const actors = capture.rows.get('characters')!, events = capture.rows.get('historicalTimelineEvents')!
  const visibility = { class: 'public' as const, audienceKeys: [], policyVersion: 'scale-declared-v1' }
  const texts: Array<{ sourceKey: string; field: string; text: string }> = []
  const evidence = async (text: string, field: string) => {
    const sourceContentHash = await hashNarrativeBytesV1(text)
    return [{ evidenceKey: 'declared-span', source: { self: true as const }, fieldPointer: `/${field}`, sourceContentHash,
      start: 0, end: new TextEncoder().encode(text).length, normalizationVersion: 'raw-utf8-v1' as const, spanHash: sourceContentHash, supportRole: 'supports' as const }]
  }
  for (let index = 0; index < actorCount; index++) {
    const name = `行者${String(index + 1).padStart(3, '0')}`, resourceUid = uid('character', index + 1)
    actors.push({ id: index + 1, projectId: 1, worldId: 1, ragDocumentId: resourceUid, name,
      roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '',
      narrativeVisibilityV1: visibility, narrativeModalityV1: 'established', narrativeEvidenceV1: await evidence(name, 'name'), createdAt: STAMP, updatedAt: STAMP })
    texts.push({ sourceKey: `character:${resourceUid}`, field: 'name', text: name })
  }
  const remaining = characterCount - texts.reduce((sum, item) => sum + [...item.text].length, 0)
  const early = Math.min(eventCount - 1, Math.floor(eventCount * plan.needles.earlyFraction)), late = Math.floor(eventCount * plan.needles.lateFraction)
  for (let index = 0; index < eventCount; index++) {
    const length = Math.floor(remaining / eventCount) + (index < remaining % eventCount ? 1 : 0)
    const description = scene(index, length, early, late), resourceUid = uid('historical-event', index + 1)
    const row: NarrativeDomainRowV1 = { id: index + 1, projectId: 1, worldId: 1, ragDocumentId: resourceUid,
      title: `河湾纪事 ${index + 1}`, description, order: index, createdAt: STAMP, updatedAt: STAMP,
      narrativeVisibilityV1: visibility, narrativeModalityV1: 'established', narrativeEvidenceV1: await evidence(description, 'description'),
      narrativeEventV1: { eventType: 'action', participants: Array.from({ length: 4 }, (_, offset) => {
        const actor = actors[(index * 7 + offset * 11) % actorCount]
        return { entity: { characterId: actor.id!, sourceUid: actor.ragDocumentId as string }, role: `participant-${offset + 1}` }
      }), locations: [], propositions: [], effects: [], communication: null, observer: null, before: [] },
    }
    events.push(row)
    texts.push({ sourceKey: `fact:${resourceUid}`, field: 'description', text: description })
  }
  // Hashing is outside compile timing. The fixture follows the same registered
  // source hash contract, but these synthetic receipts are not author reviews.
  for (const [table, rows] of [['characters', actors], ['historicalTimelineEvents', events]] as const) {
    for (const row of rows) row.narrativeAuthorityV1 = { version: 1, mode: 'author-declaration', confirmationUid: `confirmation:v1:${uuid((table === 'characters' ? 0 : actorCount) + row.id!)}`,
      confirmedAt: STAMP, contentHash: await hashNarrativeDomainSourceV1(capture, table, row) }
  }
  input.records = deriveRegisteredSemanticRowsV1({ rows: new Map([['characters', actors], ['historicalTimelineEvents', events]]), worldId: 1, workId: 1 }).records
  const unique = new Set(texts.map(item => item.text))
  const unicodeCharacters = texts.reduce((sum, item) => sum + [...item.text].length, 0)
  const distinctTextCharacters = [...unique].reduce((sum, text) => sum + [...text].length, 0)
  return { input, stats: { generatorVersion: plan.generatorVersion, unicodeCharacters, distinctTextCharacters,
    duplicateExactTextCharacters: unicodeCharacters - distinctTextCharacters, sourceFields: texts.length, uniqueTexts: unique.size,
    declaredRecords: actorCount + eventCount, declaredParticipantEdges: eventCount * 4, inputBytes: new TextEncoder().encode(canonicalNarrativeJsonV1(input)).length,
    contentNature: 'varied deterministic synthetic scenes; not literary or independently annotated quality evidence' },
    needles: [
      { query: plan.needles.earlyQuery, quote: plan.needles.earlyQuote, sourceUid: uid('historical-event', early + 1), eventPosition: early, fraction: early / eventCount },
      { query: plan.needles.lateQuery, quote: plan.needles.lateQuote, sourceUid: uid('historical-event', late + 1), eventPosition: late, fraction: late / eventCount },
    ] }
}
