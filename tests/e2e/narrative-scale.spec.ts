import { chromium, expect, test, type CDPSession } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { cpus, totalmem, platform, release } from 'node:os'
const modulePath = '/storyforge/tests/helpers/narrative-scale-browser.ts'
const mode = process.env.NW_SCALE_BROWSER_MODE
const full = mode === 'acceptance'

function processTreeRss(root: number) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n')
    .map(line => { const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number); return { pid, ppid, bytes: rss * 1024 } })
  const descendants = new Set([root])
  for (let prior = -1; prior !== descendants.size;) {
    prior = descendants.size
    for (const row of rows) if (descendants.has(row.ppid)) descendants.add(row.pid)
  }
  return { bytes: rows.filter(row => descendants.has(row.pid)).reduce((sum, row) => sum + row.bytes, 0), processes: descendants.size }
}
const p95 = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : null

test('NW-2E frozen package scale measurement (explicit opt-in; diagnostics are not acceptance)', async ({ baseURL }) => {
  test.skip(mode !== 'diagnostic' && !full, 'Explicit NW_SCALE_BROWSER_MODE and a new report destination are required')
  test.setTimeout(full ? 3_600_000 : 900_000)
  const profile = process.env.NW_SCALE_PROFILE ?? 'compiler-v1'
  if (!['compiler-v1', 'compiler-v2'].includes(profile)) throw Error('Unknown scale compiler profile')
  const planPath = `tests/acceptance/narrative-world/scale-plan-20261015-${profile === 'compiler-v2' ? 'v2' : 'v1'}.json`
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as typeof import('../acceptance/narrative-world/scale-plan-20261015-v1.json') & {
    minimumEpistemicRecordsBySize?: Record<string, number>
  }
  const vectorsPath = profile === 'compiler-v2' ? process.env.NW_SCALE_BROWSER_VECTORS : 'tests/acceptance/narrative-world/scale-diagnostic-20261015-v1.json'
  if (!vectorsPath) throw Error('Compiler-v2 requires separately frozen NW_SCALE_BROWSER_VECTORS; never reuse legacy vectors')
  const vectorFile = JSON.parse(readFileSync(vectorsPath, 'utf8'))
  if (profile === 'compiler-v2' && (vectorFile.schema !== 'storyforge.narrative-scale-v2-vectors'
    || vectorFile.compilerVersion !== 'narrative-domain-v2' || vectorFile.plan !== 'scale-plan-20261015-v2.json')) throw Error('Compiler-v2 vector identity mismatch')
  const vectors = vectorFile.results as Array<{ size: number; inputHash: string; contentHash: string; indexHash: string }>
  const destination = process.env.NW_SCALE_BROWSER_REPORT
  if (!destination) throw Error('NW_SCALE_BROWSER_REPORT must name a new receipt file')
  const profileDirectory = process.env.NW_SCALE_BROWSER_PROFILE_DIR
  const heapDirectory = process.env.NW_SCALE_BROWSER_HEAP_PROFILE_DIR
  if (full && (profileDirectory || heapDirectory)) throw Error('Profiling is diagnostic only; do not mix it with acceptance measurements')
  if (profileDirectory) mkdirSync(profileDirectory, { recursive: true })
  if (heapDirectory) mkdirSync(heapDirectory, { recursive: true })
  const startHeapProfile = async (session: CDPSession) => {
    await session.send('HeapProfiler.startSampling', { samplingInterval: 32768,
      includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  }
  const finishHeapProfile = async (session: CDPSession, label: string) => {
    const { profile } = await session.send('HeapProfiler.stopSampling')
    const path = join(heapDirectory!, `${label}.heapprofile`)
    writeFileSync(path, JSON.stringify(profile), { flag: 'wx' })
    return path
  }
  const finishProfile = async (session: CDPSession, label: string) => {
    const { profile } = await session.send('Profiler.stop')
    const path = join(profileDirectory!, `${label}.cpuprofile`)
    writeFileSync(path, JSON.stringify(profile), { flag: 'wx' })
    return path
  }
  const sizes = process.env.NW_SCALE_BROWSER_SIZES?.split(',').map(Number) ?? plan.sourceUnicodeCharacters
  if (sizes.some(size => !plan.sourceUnicodeCharacters.includes(size)) || new Set(sizes).size !== sizes.length
    || (full && (sizes.length !== plan.sourceUnicodeCharacters.length || plan.sourceUnicodeCharacters.some(size => !sizes.includes(size))))) {
    throw Error('Acceptance uses every frozen plan size; diagnostics may select a subset')
  }
  const fingerprint = JSON.parse(readFileSync(process.env.NW_SCALE_BROWSER_SOURCES ?? 'tests/acceptance/narrative-world/scale-sources-20261015-v2.json', 'utf8')) as { sourceHashes: Record<string, string> }
  const paths = [...new Set([...Object.keys(fingerprint.sourceHashes), 'tests/helpers/narrative-scale-browser.ts',
    'tests/e2e/narrative-scale.spec.ts', planPath, vectorsPath, 'tests/helpers/narrative-scale-v2-fixture.ts',
    'scripts/serve-e2e-snapshot.mjs', 'playwright.config.ts', 'vite.config.ts', 'index.html'])].sort()
  const sourceHashes = Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]))
  const runs: Array<Record<string, unknown>> = []
  const failures: string[] = []
  const generatedAt = new Date().toISOString()
  let browserVersion = ''
  try {
    for (const size of sizes) for (let run = 0; run < (full ? plan.thresholds.minimumColdRuns : 1); run++) {
      const row: Record<string, unknown> = { size, run: run + 1 }; runs.push(row)
      const server = await chromium.launchServer({ headless: true })
      const browser = await chromium.connect(server.wsEndpoint())
      browserVersion = browser.version()
      let phase = 'prepare'
      let sampler: ReturnType<typeof setInterval> | undefined
      try {
        const context = await browser.newContext(), page = await context.newPage()
        await page.goto(baseURL!)
        const prepared = await page.evaluate(async ({ modulePath, size, profile }) => {
          const harness = await new Function('p', 'return import(p)')(modulePath)
          return profile === 'compiler-v2' ? harness.prepareScaleV2(size) : harness.prepareScaleV1(size)
        }, { modulePath, size, profile })
        expect(prepared.compilerVersion).toBe(profile === 'compiler-v2' ? 'narrative-domain-v2' : 'narrative-domain-v1')
        row.prepared = prepared
        const cdp = await context.newCDPSession(page)
        await cdp.send('HeapProfiler.collectGarbage')
        const pid = server.process().pid!
        const baseline = processTreeRss(pid), samples: Array<{ elapsedMs: number; bytes: number; processes: number }> = []
        let memoryError: string | null = null
        const start = Date.now()
        const sample = () => { try { samples.push({ elapsedMs: Date.now() - start, ...processTreeRss(pid) }) } catch (error) { memoryError = String(error) } }
        phase = 'compile'; console.info(`[NW scale] ${size}/${run + 1}: ${phase}`)
        if (profileDirectory) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start') }
        if (heapDirectory) await startHeapProfile(cdp)
        sampler = setInterval(sample, 100); sample()
        try { row.compilation = await page.evaluate(async modulePath => (await new Function('p', 'return import(p)')(modulePath)).compileScaleV1(), modulePath) }
        finally {
          sample(); clearInterval(sampler); sampler = undefined
          const peakBytes = Math.max(baseline.bytes, ...samples.map(sample => sample.bytes))
          row.memory = { method: '100ms OS RSS sum of Chromium process tree; shared pages may be counted more than once',
            baseline, peakBytes, additionalPeakBytes: peakBytes - baseline.bytes, samples, error: memoryError }
          if (profileDirectory) row.compilationProfile = await finishProfile(cdp, `${size}-${run + 1}-compile`)
          if (heapDirectory) row.compilationHeapProfile = await finishHeapProfile(cdp, `${size}-${run + 1}-compile`)
        }
        phase = 'export'; console.info(`[NW scale] ${size}/${run + 1}: ${phase}`)
        const exported = await page.evaluate(async modulePath => (await new Function('p', 'return import(p)')(modulePath)).exportScaleV1(), modulePath)
        const { bytes, ...exportMetadata } = exported; row.export = exportMetadata
        await context.close()
        phase = 'import'; console.info(`[NW scale] ${size}/${run + 1}: ${phase}`)
        const restored = await browser.newContext(), imported = await restored.newPage()
        await imported.goto(baseURL!)
        row.import = await imported.evaluate(async ({ modulePath, bytes }) => (await new Function('p', 'return import(p)')(modulePath)).importScaleV1(bytes), { modulePath, bytes })
        // Reload after real import/cache deletion: no verified in-memory cache
        // or capability can survive in this new JavaScript realm.
        await imported.reload()
        row.moduleSetupMs = await imported.evaluate(async modulePath => {
          const start = performance.now(), load = new Function('p', 'return import(p)')
          // Dev-server modules must already be available offline. This loads
          // code only: no release read, verification or index open is invoked.
          await Promise.all([load(modulePath), load('/storyforge/src/lib/context-gateway/world-release-provider.ts'),
            load('/storyforge/src/lib/context-gateway/world-release-query-provider.ts')])
          return performance.now() - start
        }, modulePath)
        await restored.setOffline(true)
        phase = 'cold-index'; console.info(`[NW scale] ${size}/${run + 1}: ${phase}`)
        const coldProfile = profileDirectory || heapDirectory ? await restored.newCDPSession(imported) : null
        if (coldProfile && profileDirectory) { await coldProfile.send('Profiler.enable'); await coldProfile.send('Profiler.start') }
        if (coldProfile && heapDirectory) await startHeapProfile(coldProfile)
        try { row.open = await imported.evaluate(async modulePath => (await new Function('p', 'return import(p)')(modulePath)).openScaleV1(), modulePath) }
        finally {
          if (coldProfile && profileDirectory) row.coldIndexProfile = await finishProfile(coldProfile, `${size}-${run + 1}-cold`)
          if (coldProfile && heapDirectory) row.coldIndexHeapProfile = await finishHeapProfile(coldProfile, `${size}-${run + 1}-cold`)
        }
        phase = 'warm-query'
        const queries = []
        for (let index = 0; index < (full ? plan.thresholds.minimumWarmRuns : 2); index++) {
          const needle = prepared.needles[index % prepared.needles.length]
          queries.push({ query: needle.query, ...await imported.evaluate(async ({ modulePath, needle }) =>
            (await new Function('p', 'return import(p)')(modulePath)).queryScaleV1(needle), { modulePath, needle }) })
        }
        row.queries = queries
        await restored.close()
      } catch (error) {
        row.error = { phase, message: error instanceof Error ? error.message : String(error) }
        failures.push(`${size}/${run + 1}: ${phase}`)
      } finally {
        if (sampler) clearInterval(sampler)
        await browser.close(); await server.close()
      }
    }
  } finally {
    const sourceUnchanged = paths.every(path => sourceHashes[path] === createHash('sha256').update(readFileSync(path)).digest('hex'))
    const deviceMatches = cpus()[0]?.model === plan.referenceDevice.cpu && totalmem() === plan.referenceDevice.memoryBytes
      && process.arch === plan.referenceDevice.architecture && platform() === 'darwin'
      && plan.referenceDevice.browser.endsWith(browserVersion)
      && execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim() === plan.referenceDevice.os.match(/macOS ([\d.]+)/)?.[1]
      && execFileSync('sw_vers', ['-buildVersion'], { encoding: 'utf8' }).trim() === plan.referenceDevice.os.match(/\(([^)]+)\)/)?.[1]
    if (!sourceUnchanged) failures.push('source-changed-during-measurement')
    if (!deviceMatches) failures.push('reference-device-mismatch')
    const summaries = sizes.map(size => {
      const rows = runs.filter(row => row.size === size)
      const compiled = rows.flatMap(row => row.compilation ? [row.compilation as { compileMs: number; records: number; edges: number }] : [])
      const cold = rows.flatMap(row => row.open ? [(row.open as { coldIndexMs: number }).coldIndexMs] : [])
      const queries = rows.flatMap(row => (row.queries ?? []) as Array<{ queryMs: number; exactEvidenceFound: boolean; status: string }>)
      const memory = rows.flatMap(row => row.memory ? [(row.memory as { additionalPeakBytes: number }).additionalPeakBytes] : [])
      const vector = vectors.find(item => item.size === size)
      const packageHashes = rows.flatMap(row => row.export ? [(row.export as { packageHash: string }).packageHash] : [])
      const gates = { fullCompile: compiled.length > 0 && compiled.every(item => item.compileMs <= plan.thresholds.fullCompileMs),
        coldIndex: cold.length > 0 && p95(cold)! <= plan.thresholds.coldIndexP95Ms,
        warmQuery: queries.length > 0 && p95(queries.map(item => item.queryMs))! <= plan.thresholds.warmQueryP95Ms,
        memory: memory.length > 0 && rows.every(row => row.memory && !(row.memory as { error: string | null }).error)
          && Math.max(...memory) <= plan.thresholds.additionalPeakMemoryBytes,
        exactEvidence: queries.length > 0 && queries.every(item => item.status === 'matched' && item.exactEvidenceFound),
        frozenBytes: !!vector && rows.every(row => (row.prepared as { inputHash?: string } | undefined)?.inputHash === vector.inputHash
          && (row.compilation as { contentHash?: string } | undefined)?.contentHash === vector.contentHash
          && (row.compilation as { indexHash?: string } | undefined)?.indexHash === vector.indexHash),
        identicalExportedPackages: packageHashes.length === rows.length && new Set(packageHashes).size === 1,
        scale: compiled.length > 0 && (size !== 1_000_000 || compiled.every(item => item.records >= plan.thresholds.minimumSemanticRecordsAtMillion && item.edges >= plan.thresholds.minimumEdgesAtMillion)),
        independentKnowledgeProfile: profile === 'compiler-v1' || rows.every(row => {
          const proof = row.compilation as { compilerVersion?: string; epistemicRecords?: number; privateAssertions?: number; independentVisibleBeliefs?: number } | undefined
          const minimum = plan.minimumEpistemicRecordsBySize?.[String(size)]
          return typeof minimum === 'number' && minimum > 0 && proof?.compilerVersion === 'narrative-domain-v2'
            && (proof.epistemicRecords ?? 0) >= minimum && (proof.privateAssertions ?? 0) >= minimum && (proof.independentVisibleBeliefs ?? 0) >= minimum
        }),
        sampleCount: cold.length >= plan.thresholds.minimumColdRuns && queries.length >= plan.thresholds.minimumWarmRuns,
        noFailures: rows.every(row => !row.error) }
      for (const [gate, passed] of Object.entries(gates)) if (!passed) failures.push(`${size}: ${gate}`)
      return { size, coldIndexP95Ms: p95(cold), warmQueryP95Ms: p95(queries.map(item => item.queryMs)), gates }
    })
    writeFileSync(destination, JSON.stringify({ schema: 'storyforge.narrative-scale-browser-evaluation', version: 1, generatedAt, mode,
      evidenceLevel: full ? 'isolated-browser-engineering-gates' : 'single-browser-diagnostic-not-performance-acceptance',
      plan: planPath.split('/').at(-1), profile, vectorsPath,
      environment: { cpu: cpus()[0]?.model, totalMemoryBytes: totalmem(), platform: platform(), osRelease: release(), browserVersion },
      memoryCaveat: 'Process RSS is sampled, not an exact allocation counter; shared pages may be double-counted. All samples and baseline are retained.',
      sourceHashes, sourceUnchanged, deviceMatches, runs, summaries, failures,
      cpuProfiling: !!profileDirectory, heapProfiling: !!heapDirectory,
      heapSampling: heapDirectory ? { intervalBytes: 32768, includesCollectedObjects: true,
        interpretation: 'Sampled allocation totals including collected objects; not retained heap, RSS or acceptance evidence.' } : null,
      accepted: full && failures.length === 0, modelCalls: 0, independentHumanReviews: 0 }, null, 2) + '\n', { flag: 'wx' })
  }
  if (full) expect(failures).toEqual([])
})
