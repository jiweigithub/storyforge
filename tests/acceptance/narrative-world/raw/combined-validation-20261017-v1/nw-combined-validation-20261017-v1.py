from pathlib import Path
import datetime, hashlib, json, os, shutil, signal, socket, subprocess, sys

root = Path('/Users/qinyingying/.codex/worktrees/nw-mainline-refresh-20261016/storyforge')
prefix = Path('/tmp/nw-combined-validation-20261017-v1')
pin_path = Path(str(prefix) + '-sources.json')
pin = json.loads(pin_path.read_text())
terminal = Path(str(prefix) + '-terminal.json')
assert not terminal.exists()

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def verify():
    assert Path.cwd() == root
    assert digest(Path(__file__)) == pin['runnerSha256'], 'Runner changed'
    for ref, key in [('HEAD', 'head'), ('MERGE_HEAD', 'mergeHead')]:
        assert subprocess.check_output(['git', 'rev-parse', ref], text=True).strip() == pin[key]
    bad = [p for p, h in pin['files'].items() if not (root / p).is_file() or digest(root / p) != h]
    assert not bad, 'Pinned inputs changed: ' + json.dumps(bad)

def stop(signum, _frame): raise SystemExit(128 + signum)
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
record = {'schema': 'storyforge.narrative-combined-validation', 'version': 1, 'startedAt': utc(),
          'root': str(root), 'head': pin['head'], 'mergeHead': pin['mergeHead'],
          'pinSha256': digest(pin_path), 'sourceFiles': len(pin['files']),
          'phases': [], 'sourceUnchanged': False, 'fullCI': False, 'fullE2E': False,
          'performanceAcceptance': False, 'humanQualityAcceptance': False, 'modelCalls': 0, 'accepted': False}
code = 2
try:
    verify()
    env = dict(os.environ, CI='1', PLAYWRIGHT_FROZEN_WORKSPACE='1',
               PLAYWRIGHT_HTML_OUTPUT_DIR=str(prefix) + '-html')
    for key in ['NW_BASELINE_REPORT', 'NW_IR_REPORT', 'NW_DOMAIN_REPORT', 'NW_SCALE_BROWSER_MODE',
                'NW_SCALE_BROWSER_REPORT', 'NW_SCALE_BROWSER_PROFILE_DIR', 'NW_SCALE_BROWSER_SIZES']:
        env.pop(key, None)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); env['PLAYWRIGHT_PORT'] = str(sock.getsockname()[1])
    phases = [('ci', ['npm', 'run', 'ci']), ('e2e', ['npm', 'run', 'ci:e2e']),
              ('scale-diagnostic', ['node', 'node_modules/@playwright/test/cli.js', 'test',
               'tests/e2e/narrative-scale.spec.ts', '--reporter=line', '--retries=0',
               '--output=' + str(prefix) + '-scale-test-results'])]
    for name, command in phases:
        free = shutil.disk_usage(root).free / 2**30
        assert free >= 5, 'Less than 5 GiB free; next phase not dispatched'
        phase_env = dict(env)
        if name == 'scale-diagnostic':
            phase_env.update(NW_SCALE_BROWSER_MODE='diagnostic', NW_SCALE_PROFILE='compiler-v2',
                             NW_SCALE_BROWSER_SIZES='1000000',
                             NW_SCALE_BROWSER_REPORT=str(prefix) + '-scale.json',
                             NW_SCALE_BROWSER_VECTORS='tests/acceptance/narrative-world/scale-vectors-20261015-v2.json',
                             NW_SCALE_BROWSER_SOURCES=str(prefix) + '-scale-sources.json')
        log = Path(str(prefix) + '-' + name + '.log')
        item = {'name': name, 'command': command, 'startedAt': utc(), 'log': str(log), 'freeGiB': free}
        record['phases'].append(item)
        print(json.dumps({'starting': name, 'at': item['startedAt'], 'log': str(log)}), flush=True)
        with log.open('x') as output:
            code = subprocess.call(command, env=phase_env, stdout=output, stderr=subprocess.STDOUT)
        item.update(exitCode=code, endedAt=utc(), logSha256=digest(log))
        verify()
        if code: raise RuntimeError(name + ' exited ' + str(code))
        if name == 'ci': record['fullCI'] = True
        if name == 'e2e': record['fullE2E'] = True
        if name == 'scale-diagnostic':
            report_path = Path(str(prefix) + '-scale.json'); result = json.loads(report_path.read_text())
            assert result['profile'] == 'compiler-v2' and result['mode'] == 'diagnostic'
            assert result['sourceUnchanged'] and not result['cpuProfiling'] and result['accepted'] is False
            record.update(diagnosticCompleted=True, diagnosticFailures=result['failures'],
                          diagnosticReport=str(report_path), diagnosticSha256=digest(report_path))
    code = 0
except BaseException as error:
    record['error'] = type(error).__name__ + ': ' + str(error)
    code = error.code if isinstance(error, SystemExit) and isinstance(error.code, int) else (code or 2)
finally:
    try: verify(); record['sourceUnchanged'] = True
    except BaseException as error:
        record['sourceCheckError'] = type(error).__name__ + ': ' + str(error); code = 2
    record.update(exitCode=code, endedAt=utc())
    with terminal.open('x') as output: json.dump(record, output, ensure_ascii=False, indent=2); output.write('\n')
    print(json.dumps({'exitCode': code, 'fullCI': record['fullCI'], 'fullE2E': record['fullE2E'],
                      'sourceUnchanged': record['sourceUnchanged'], 'terminal': str(terminal), 'accepted': False}), flush=True)
sys.exit(code)
