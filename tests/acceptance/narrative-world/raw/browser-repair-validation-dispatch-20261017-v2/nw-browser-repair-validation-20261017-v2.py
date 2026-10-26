from pathlib import Path
import datetime, hashlib, json, os, shutil, signal, socket, subprocess, sys

root = Path('/Users/qinyingying/.codex/worktrees/nw-mainline-refresh-20261016/storyforge')
prefix = Path('/tmp/nw-browser-repair-validation-20261017-v2')
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
    changed = [p for p, h in pin['files'].items() if not (root / p).is_file() or digest(root / p) != h]
    assert not changed, 'Pinned inputs changed: ' + json.dumps(changed)
def stop(signum, _frame): raise SystemExit(128 + signum)
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
record = {'schema': 'storyforge.narrative-browser-repair-validation', 'version': 2, 'startedAt': utc(),
          'root': str(root), 'head': pin['head'], 'mergeHead': pin['mergeHead'],
          'pinSha256': digest(pin_path), 'sourceFiles': len(pin['files']), 'phases': [],
          'sourceUnchanged': False, 'buildPassed': False, 'bundlePassed': False,
          'fullCI': False, 'fullE2E': False, 'targetedE2E': False, 'performanceAcceptance': False,
          'humanQualityAcceptance': False, 'modelCalls': 0, 'accepted': False}
code = 2
try:
    verify()
    env = dict(os.environ, CI='1', PLAYWRIGHT_FROZEN_WORKSPACE='1',
               PLAYWRIGHT_HTML_OUTPUT_DIR=str(prefix) + '-html')
    for key in ['NW_BASELINE_REPORT', 'NW_IR_REPORT', 'NW_DOMAIN_REPORT', 'NW_SCALE_BROWSER_MODE',
                'NW_SCALE_BROWSER_REPORT', 'NW_SCALE_BROWSER_PROFILE_DIR', 'NW_SCALE_BROWSER_SIZES', 'NW_SCALE_PROFILE']:
        env.pop(key, None)
    native = ['tests/e2e/narrative-' + name + '.spec.ts' for name in [
        'annotation-review', 'derivation-recovery', 'domain-lifecycle', 'impact', 'query', 'release-package', 'source-plan']]
    playwright = ['node', 'node_modules/@playwright/test/cli.js', 'test']
    phases = [('build', ['npm', 'run', 'build']), ('bundle', ['npm', 'run', 'check:bundle-size']),
              ('scale-diagnostic', playwright + ['tests/e2e/narrative-scale.spec.ts', '--reporter=line', '--retries=0',
                                                 '--output=' + str(prefix) + '-scale-test-results']),
              ('targeted-e2e', playwright + native + ['--reporter=line', '--retries=0',
                                                      '--output=' + str(prefix) + '-native-test-results'])]
    for name, command in phases:
        free = shutil.disk_usage(root).free / 2**30
        assert free >= 5, 'Less than 5 GiB free; next phase not dispatched'
        phase_env = dict(env)
        if name in ['scale-diagnostic', 'targeted-e2e']:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0)); phase_env['PLAYWRIGHT_PORT'] = str(sock.getsockname()[1])
        if name == 'scale-diagnostic':
            phase_env.update(NW_SCALE_BROWSER_MODE='diagnostic', NW_SCALE_PROFILE='compiler-v2',
                             NW_SCALE_BROWSER_SIZES='1000000', NW_SCALE_BROWSER_REPORT=str(prefix) + '-scale.json',
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
        if name == 'build': record['buildPassed'] = True
        if name == 'bundle': record['bundlePassed'] = True
        if name == 'targeted-e2e': record.update(targetedE2E=True, targetedE2ESuites=native)
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
    print(json.dumps({'exitCode': code, 'sourceUnchanged': record['sourceUnchanged'], 'buildPassed': record['buildPassed'],
                      'targetedE2E': record['targetedE2E'], 'terminal': str(terminal), 'accepted': False}), flush=True)
sys.exit(code)
