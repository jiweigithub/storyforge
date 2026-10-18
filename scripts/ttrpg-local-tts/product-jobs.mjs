// One physical local worker, immutable job input and an irreversible launch
// claim. Creating/reading a waiting job never starts inference, even on restart.
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, existsSync, lstatSync, appendFileSync, statfsSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { base, stable, digest, productProfile as profile, productProfileHash, assertProductImplementation, readStoredProductJob, validateProductJob, verifyProductResult, ownedRuntime } from './product-contract.mjs'

function writeNew(file, value) {
  const fd = openSync(file, 'wx', 0o600)
  try { writeFileSync(fd, stable(value)); fsyncSync(fd) } finally { closeSync(fd) }
  const directory = openSync(path.dirname(file), 'r'); try { fsyncSync(directory) } finally { closeSync(directory) }
}
function atomic(file, value) { const temp = file + '.' + randomUUID() + '.tmp'; writeNew(temp, value); renameSync(temp, file); const dir = openSync(path.dirname(file), 'r'); try { fsyncSync(dir) } finally { closeSync(dir) } }
function read(file) {
  const st = lstatSync(file)
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || st.nlink !== 1 || st.size > 65536) throw new Error('Unsafe owned job record')
  return JSON.parse(readFileSync(file, 'utf8'))
}
function processStart(pid) {
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).trim() || null }
  catch (error) { if (error.status === 1) return null; throw new Error('Cannot observe process identity; preserve the job') }
}
export function createProductVoiceJobs(runtimeDir, options = {}) {
  assertProductImplementation()
  const runtime = ownedRuntime(runtimeDir), jobs = path.join(runtime, 'product-jobs-v2'), lock = path.join(runtime, '.product-voice-worker.lock'), physicalSlot = path.join(runtime, '.eval.lock')
  mkdirSync(jobs, { recursive: true, mode: 0o700 })
  const active = new Map(), owner = { pid: process.pid, start: processStart(process.pid), token: randomUUID() }
  if (!owner.start || lstatSync(jobs).isSymbolicLink() || lstatSync(jobs).uid !== process.getuid()) throw new Error('Cannot own speech jobs')
  const worker = path.join(base, 'product-worker.py'), injected = typeof options.spawnWorker === 'function'
  let closed = false
  function directory(jobKey) { if (typeof jobKey !== 'string' || !/^ttrpg\.voice\.[1-9][0-9]*\.[a-f0-9]{64}$/.test(jobKey)) throw new Error('Invalid original job key'); return path.join(jobs, digest(jobKey)) }
  function jobData(jobKey) {
    const dir = directory(jobKey)
    if (!existsSync(dir)) return null
    const st = lstatSync(dir)
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error('Unowned speech job')
    const input = readStoredProductJob(read(path.join(dir, 'input.json'))), record = read(path.join(dir, 'job.json'))
    if (input.jobKey !== jobKey || record.jobKey !== jobKey || record.inputArtifactHash !== input.inputArtifactHash) throw new Error('Original job binding changed')
    return { dir, input, record }
  }
  function liveWorker(dir) {
    const lines = execFileSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).split('\n').slice(1)
    return lines.some(line => line.includes('product-worker.py') && line.includes(dir))
  }
  function archiveOwnPhysicalSlot(claim, kind) {
    if (!existsSync(physicalSlot)) return
    const held = read(physicalSlot)
    if (held.kind !== 'product-voice-physical-slot') return // Never retire an evaluation's lock.
    if (held.jobKey !== claim.jobKey || held.inputArtifactHash !== claim.inputArtifactHash || held.nonce !== claim.nonce) throw new Error('Physical speech slot identity changed')
    mkdirSync(path.join(jobs, 'lock-history'), { recursive: true, mode: 0o700 })
    renameSync(physicalSlot, path.join(jobs, 'lock-history', 'physical-' + kind + '-' + claim.nonce + '.json'))
  }
  function archiveUnlaunchedLocks(claim, physicalAcquired = true) {
    if (read(lock).nonce !== claim.nonce) throw new Error('Worker lock owner changed')
    if (physicalAcquired) archiveOwnPhysicalSlot(claim, 'not-launched')
    mkdirSync(path.join(jobs, 'lock-history'), { recursive: true, mode: 0o700 })
    renameSync(lock, path.join(jobs, 'lock-history', 'not-launched-' + claim.nonce + '.json'))
  }
  function retireLockIfObservedAbsent() {
    if (!existsSync(lock)) return true
    const old = read(lock), dir = directory(old.jobKey)
    if (!old.owner || !Number.isSafeInteger(old.owner.pid) || !old.owner.start || !old.nonce) throw new Error('Unidentified worker lock; preserve all')
    const state = read(path.join(dir, 'job.json')), startedFile = path.join(dir, 'worker-started.json')
    const started = existsSync(startedFile) ? read(startedFile) : null
    const terminal = state.terminal?.kind === 'observed-child-close'
    if (liveWorker(dir)) return false
    if (!terminal && (!started || started.jobKey !== old.jobKey || started.launchNonce !== old.nonce
      || started.inputArtifactHash !== old.inputArtifactHash || !Number.isSafeInteger(started.pid) || !started.processStart
      || processStart(started.pid) === started.processStart)) return false
    // A missing controller PID is insufficient. A real terminal observation,
    // or a pinned worker's startup identity observed gone, is required. This
    // releases capacity only; an unconfirmed old job still stays unknown.
    archiveOwnPhysicalSlot(old, 'observed-absent')
    mkdirSync(path.join(jobs, 'lock-history'), { recursive: true, mode: 0o700 })
    renameSync(lock, path.join(jobs, 'lock-history', 'unconfirmed-' + old.nonce + '.json'))
    return true
  }
  function projection(jobKey) {
    const job = jobData(jobKey)
    if (!job) return { jobKey, status: 'not-found', canStart: false, cancellationConfirmed: false }
    const { dir, input, record } = job, claim = existsSync(path.join(dir, 'start.json')) ? read(path.join(dir, 'start.json')) : null, running = active.get(jobKey)
    let status = record.status, cancellationConfirmed = record.cancellationConfirmed === true
    if (claim?.kind === 'cancelled-before-start') { status = 'cancelled-before-start'; cancellationConfirmed = true }
    else if (claim && !record.terminal && !running) status = liveWorker(dir) ? 'running-observed' : 'unknown'
    if (!claim && record.status !== 'waiting-for-slot' && record.status !== 'cancelled-before-start') throw new Error('Job status lacks its launch proof')
    return { jobKey, inputArtifactHash: input.inputArtifactHash, profileHash: input.execution.profileHash, status,
      canStart: input.execution.profileHash === productProfileHash && !closed && !claim && record.status === 'waiting-for-slot' && !existsSync(path.join(runtime, '.setup.lock')) && retireLockIfObservedAbsent() && !existsSync(physicalSlot),
      cancellationRequested: existsSync(path.join(dir, 'cancel-request.json')), cancellationConfirmed,
      workerExecutionKind: record.workerExecutionKind, hasResultFile: existsSync(path.join(dir, 'result.json')), automaticRetryAllowed: false }
  }
  function create(value) {
    if (closed) throw new Error('Speech service closed')
    assertProductImplementation(); const input = validateProductJob(value), dir = directory(input.jobKey)
    if (existsSync(dir)) {
      const prior = jobData(input.jobKey)
      if (stable(prior.input) !== stable(input)) throw new Error('Cannot replace the original speech payload')
      return projection(input.jobKey)
    }
    mkdirSync(dir, { mode: 0o700 })
    writeNew(path.join(dir, 'input.json'), input)
    writeNew(path.join(dir, 'job.json'), { jobKey: input.jobKey, inputArtifactHash: input.inputArtifactHash, status: 'waiting-for-slot', createdAt: Date.now(),
      workerExecutionKind: injected ? 'injected-test-worker' : 'pinned-offline-worker', cancellationConfirmed: false })
    return projection(input.jobKey)
  }
  function cancel(jobKey, reason = 'explicit-user-cancel') {
    const job = jobData(jobKey)
    if (!job) return projection(jobKey)
    const file = path.join(job.dir, 'cancel-request.json')
    if (!existsSync(file)) writeNew(file, { jobKey, inputArtifactHash: job.input.inputArtifactHash, at: Date.now(), reason })
    const run = active.get(jobKey)
    if (run) run.stop(reason)
    else if (!existsSync(path.join(job.dir, 'start.json'))) {
      // Cancellation and start compete for the same immutable claim. Checking
      // two separate files would permit a false "never launched" race.
      try {
        writeNew(path.join(job.dir, 'start.json'), { kind: 'cancelled-before-start', jobKey, inputArtifactHash: job.input.inputArtifactHash, at: Date.now() })
        atomic(path.join(job.dir, 'job.json'), { ...job.record, status: 'cancelled-before-start', cancellationConfirmed: true, terminal: { kind: 'never-launched', at: Date.now() } })
      } catch (error) { if (error.code !== 'EEXIST') throw error }
    }
    // No signal is sent to an unowned/reused PID after a service restart.
    return projection(jobKey)
  }
  function start(jobKey, inputArtifactHash) {
    if (closed) throw new Error('Speech service closed')
    assertProductImplementation(); const job = jobData(jobKey)
    if (!job || job.input.inputArtifactHash !== inputArtifactHash) throw new Error('Original speech input not found')
    if (existsSync(path.join(job.dir, 'start.json')) || existsSync(path.join(job.dir, 'cancel-request.json'))) return projection(jobKey)
    validateProductJob(job.input)
    if (existsSync(path.join(runtime, '.setup.lock')) || !retireLockIfObservedAbsent() || existsSync(physicalSlot)) return projection(jobKey)
    const disk = statfsSync(runtime)
    if (disk.bavail * disk.bsize < profile.minimumFreeBytes) throw new Error('Insufficient free space; original job retained without starting')
    const nonce = randomUUID(), claim = { kind: 'start-authorized', jobKey, inputArtifactHash, owner, nonce, at: Date.now() }
    try { writeNew(lock, claim) } catch (error) { if (error.code === 'EEXIST') return projection(jobKey); throw error }
    // The existing eval launcher owns this same exclusive file. Taking only
    // a separate product lock or checking the other's file would leave a
    // check/create race and allow two physical inference processes.
    try { writeNew(physicalSlot, { ...claim, kind: 'product-voice-physical-slot' }) }
    catch (error) { if (error.code !== 'EEXIST') throw error; archiveUnlaunchedLocks(claim, false); return projection(jobKey) }
    // Installer owns .setup.lock before checking .eval.lock; both directions
    // recheck after claiming, so a simultaneous setup cannot alter live assets.
    if (existsSync(path.join(runtime, '.setup.lock'))) { archiveUnlaunchedLocks(claim); return projection(jobKey) }
    // Permanent claim precedes spawn. A lost return is unknown, never unsent.
    try { writeNew(path.join(job.dir, 'start.json'), claim) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      // The cancellation claim won before any spawn. Retain our unused lock
      // as evidence, and do not launch a worker behind that confirmation.
      archiveUnlaunchedLocks(claim)
      return projection(jobKey)
    }
    atomic(path.join(job.dir, 'job.json'), { ...job.record, status: 'launch-recorded', launchNonce: nonce })
    let leaseSequence = 1, leaseDue = process.hrtime.bigint() + BigInt(profile.authorizationLeaseMs) * 1000000n
    atomic(path.join(job.dir, 'lease.json'), { jobKey, inputArtifactHash, launchNonce: nonce, sequence: leaseSequence, expiresAt: Date.now() + profile.authorizationLeaseMs })
    let child
    try {
      child = injected ? options.spawnWorker(job.dir, job.input) : spawn(path.join(runtime, 'venv/bin/python3'), ['-I', worker, '--runtime-dir', runtime, '--job-dir', job.dir], {
        cwd: runtime, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
      })
    } catch (error) {
      atomic(path.join(job.dir, 'job.json'), { ...job.record, status: 'unknown', launchNonce: nonce, errorCode: 'spawn-return-unknown' }); throw error
    }
    let killTimer, terminal = false, stopped = false
    const counts = { stdout: 0, stderr: 0 }, truncated = { stdout: false, stderr: false }
    const stop = reason => {
      if (terminal || stopped) return
      stopped = true
      if (!existsSync(path.join(job.dir, 'cancel-request.json'))) writeNew(path.join(job.dir, 'cancel-request.json'), { jobKey, inputArtifactHash, reason, at: Date.now() })
      if (injected) child.kill('SIGTERM'); else if (child.pid) { try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error } }
      killTimer = setTimeout(() => { if (!terminal) { if (injected) child.kill('SIGKILL'); else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } } } }, 5000)
      killTimer.unref()
    }
    active.set(jobKey, { child, stop, renew() {
      if (terminal || stopped) throw new Error('Original worker is not renewably active')
      if (process.hrtime.bigint() >= leaseDue) { stop('original-authorization-lease-expired'); throw new Error('Original authorization lease already expired') }
      leaseSequence++
      atomic(path.join(job.dir, 'lease.json'), { jobKey, inputArtifactHash, launchNonce: nonce, sequence: leaseSequence, expiresAt: Date.now() + profile.authorizationLeaseMs })
      leaseDue = process.hrtime.bigint() + BigInt(profile.authorizationLeaseMs) * 1000000n
    } })
    for (const name of ['stdout', 'stderr']) child[name]?.on('data', data => {
      const remaining = profile.maxDiagnosticBytes - counts[name]
      if (remaining > 0) appendFileSync(path.join(job.dir, name + '.log'), data.subarray(0, remaining), { mode: 0o600 })
      counts[name] += data.length
      if (counts[name] > profile.maxDiagnosticBytes) { truncated[name] = true; stop('diagnostic-output-limit') }
    })
    const deadline = setTimeout(() => stop('profile-deadline'), profile.timeoutMs); deadline.unref()
    const leaseTimer = setInterval(() => { if (process.hrtime.bigint() > leaseDue) stop('original-authorization-lease-expired') }, 500); leaseTimer.unref()
    child.once('error', () => { /* close is the authoritative terminal; never retry spawn */ })
    child.once('close', (code, signal) => {
      terminal = true; clearTimeout(deadline); clearTimeout(leaseTimer); clearTimeout(killTimer); active.delete(jobKey)
      const result = existsSync(path.join(job.dir, 'result.json'))
      const status = code === 0 && result ? 'generated' : stopped ? 'cancelled-confirmed' : 'failed'
      try {
        atomic(path.join(job.dir, 'job.json'), { ...job.record, status, launchNonce: nonce, cancellationConfirmed: stopped && status !== 'generated',
          lateResult: stopped && status === 'generated', diagnostics: { counts, truncated }, terminal: { kind: 'observed-child-close', code, signal, at: Date.now() } })
        if (existsSync(lock) && read(lock).nonce === nonce) {
          archiveOwnPhysicalSlot(claim, 'terminal')
          mkdirSync(path.join(jobs, 'lock-history'), { recursive: true, mode: 0o700 })
          renameSync(lock, path.join(jobs, 'lock-history', 'terminal-' + nonce + '.json'))
        }
      } catch { /* Keep the original files/claim. Reading projects unknown; no retry or false stop receipt. */ }
    })
    atomic(path.join(job.dir, 'job.json'), { ...job.record, status: 'running', launchNonce: nonce, childPid: child.pid ?? null })
    return projection(jobKey)
  }
  function raw(jobKey) {
    const job = jobData(jobKey), state = projection(jobKey)
    if (!job || state.status !== 'generated' || job.record.terminal?.kind !== 'observed-child-close' || job.record.terminal.code !== 0) throw new Error('No observed complete raw speech result; inspect the original job')
    const result = read(path.join(job.dir, 'result.json')), wavPath = path.join(job.dir, 'audio.wav'), st = lstatSync(wavPath)
    if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || st.nlink !== 1 || st.size > profile.maxAudioBytes || st.size < 46) throw new Error('Invalid owned audio output')
    const bytes = readFileSync(wavPath); verifyProductResult(result, bytes, job.input)
    return { schema: 'storyforge.ttrpg-local-tts-product-raw-response', version: 1, result, workerExecutionKind: state.workerExecutionKind,
      cancellationRequested: state.cancellationRequested, audio: { encoding: 'base64', data: bytes.toString('base64') }, candidateAccepted: false, adoptionAllowed: false }
  }
  function renew(jobKey, inputArtifactHash) {
    const job = jobData(jobKey), run = active.get(jobKey)
    if (!job || job.input.inputArtifactHash !== inputArtifactHash || !run) throw new Error('Original live worker cannot be renewed from an unknown job')
    run.renew(); return projection(jobKey)
  }
  return { create, get: projection, start, cancel, renew, raw, close() { closed = true; for (const [key] of active) cancel(key, 'owning-service-closed') } }
}
