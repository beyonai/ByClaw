#!/usr/bin/env python3
"""Host-side Podman VM benchmark. Use only the isolated, seeded test Redis.
Raw container logs stay in a private temporary directory; JSON contains timings only.
"""
import argparse, json, os, pathlib, re, selectors, shlex, subprocess, tempfile, time


def vm(args, **kwargs):
    return subprocess.run(['podman', 'machine', 'ssh', shlex.join(['sudo', 'podman', *args])], **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--base-url', help='Explicit test-only backend override; leaves the supplied env file unchanged')
    parser.add_argument('--source-eager', action='store_true')
    args = parser.parse_args()
    private = pathlib.Path(tempfile.mkdtemp(prefix='byclaw-startup-logs-'))
    results = []
    for trial in range(1, args.runs+1):
        name = f'byclaw-startup-bench-{os.getpid()}-{trial}'
        command = ['run', '--name', name, '--network', 'byclaw-startup-verify',
                   '--cpus', '1', '--memory', '2g', '--memory-swap', '2g',
                   '--env-file', args.env_file, '-v', f'{args.env_file}:/run/byclaw-test.env:ro',
                   '-e', 'REDIS_HOST=byclaw-startup-redis', '-e', 'REDIS_PORT=6379',
                   '-e', 'REDIS_USERNAME=', '-e', 'REDIS_PASSWORD=', '-e', 'REDIS_DATABASE=0',
                   '-e', 'REDIS_MODE=standalone', '-e', 'DSH_TELEMETRY_DISABLED=1',
                   '-e', 'BYCLAW_BROWSER_STARTUP='+('eager' if args.source_eager else 'on-demand'),
                   '-e', 'BYCLAW_DSH_CLI_ENTRY='+('apps/cli/src/bin.ts' if args.source_eager else 'apps/cli/lib/bin.js'),
                   args.image, 'web', '--port', '8080', '--no-open']
        if args.base_url:
            command[command.index(args.image):command.index(args.image)] = ['-e', 'BYCLAW_DSH_BASE_URL='+args.base_url]
        start = time.monotonic()
        process = subprocess.Popen(['podman', 'machine', 'ssh', shlex.join(['sudo', 'podman', *command])],
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        selector = selectors.DefaultSelector(); selector.register(process.stdout, selectors.EVENT_READ)
        result = {'trial': trial, 'mode': 'source-eager' if args.source_eager else 'compiled-on-demand', 'phases': {}}
        buffer = b''; lines = []; worker = False; web = False
        try:
            while time.monotonic()-start < 120:
                if process.poll() is not None: break
                for key, _ in selector.select(.1):
                    data = os.read(key.fileobj.fileno(), 65536)
                    buffer += data
                    while b'\n' in buffer:
                        line, buffer = buffer.split(b'\n', 1)
                        text = line.decode(errors='replace'); lines.append(text)
                        elapsed = round(time.monotonic()-start, 3)
                        for marker, phase in [('linked image-managed plugins', 'managed-links'), ('starting CLI', 'cli'),
                                              ('startup phase=activate;', 'integration-start'), ('phase=builtin-skills-ready', 'builtin-skills'), ('phase=resources-ready', 'resources'),
                                              ('phase=worker-ready', 'worker'), ('dsh web:', 'web')]:
                            if marker in text and phase not in result['phases']: result['phases'][phase] = elapsed
                        if 'projection reason=cold-start;' in text:
                            match = re.search(r'phase=([a-z-]+)', text)
                            if match: result['phases'].setdefault('projection-'+match.group(1), elapsed)
                        if 'Worker online:' in text: worker = True; result['phases'].setdefault('worker', elapsed)
                        if 'dsh web:' in text: web = True
                if worker and web: break
            result['readySeconds'] = round(time.monotonic()-start, 3) if worker and web else None
            if worker and web:
                check = vm(['exec', name, 'node', '-e',
                    "fetch('http://127.0.0.1:8080/').then(r=>{if(r.status>=500)process.exit(1);console.log(r.status)}).catch(()=>process.exit(1))"],
                    capture_output=True, text=True)
                result['httpResponded'] = check.returncode == 0
                result['httpStatus'] = check.stdout.strip() if check.returncode == 0 else None
            else: result['httpResponded'] = False
            result['resourceSyncFailed'] = any('resource sync failed' in line or 'resource synchronization failed' in line or 'projection failed' in line or 'integration startup failed' in line for line in lines)
            result['skillSyncErrors'] = sum('Skill ' in line and 'sync failed' in line for line in lines)
        finally:
            vm(['stop', '-t', '10', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            vm(['rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
            selector.close()
            log = private/f'{trial}.log'; log.write_text('\n'.join(lines)); log.chmod(0o600)
        results.append(result)
        print(json.dumps(result), flush=True)
    print(json.dumps({'rawLogDirectory': str(private), 'results': results}), flush=True)
    if any(r['readySeconds'] is None or r['readySeconds'] >= 30 or not r['httpResponded'] or r['resourceSyncFailed'] for r in results):
        raise SystemExit(1)


if __name__ == '__main__': main()
