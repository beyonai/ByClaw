#!/usr/bin/env python3
"""Manage instance-local Nginx preview routes; stdout is the existing exec result."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

STATE = Path(os.environ.get('BYCLAW_APP_STATE', '/run/byclaw-apps'))
NGINX = os.environ.get('BYCLAW_APP_NGINX', '/usr/sbin/nginx')
DEFAULT_DOMAIN = 'cn-beijing.sandbox.aliyuncs.com'


def port_number(value):
    port = int(value)
    if not 1024 <= port <= 65535:
        raise ValueError('Application port must be between 1024 and 65535')
    return port


def base_config(port):
    return f'''pid {STATE}/nginx.pid;
error_log {STATE}/error.log warn;
events {{ worker_connections 256; }}
http {{
  access_log off;
  client_body_temp_path {STATE}/client;
  proxy_temp_path {STATE}/proxy;
  fastcgi_temp_path {STATE}/fastcgi;
  uwsgi_temp_path {STATE}/uwsgi;
  scgi_temp_path {STATE}/scgi;
  map $http_upgrade $app_connection {{ default upgrade; '' close; }}
  server {{
    listen {port};
    client_max_body_size 100m;
    location = /_health {{ default_type text/plain; return 200 'ready'; }}
    include {STATE}/routes/*.conf;
    location / {{ return 404; }}
  }}
}}
'''


def route_config(app):
    prefix = '/a/' + app['id']
    # Easel's shipped bundle has one fetch that does not use its base-path helper.
    compatibility = '''proxy_set_header Accept-Encoding "";
  sub_filter_types application/javascript text/javascript;
  sub_filter_once off;
  sub_filter '"/api/upload/limits"' '"./api/upload/limits"';
''' if app['name'] == 'easel' else ''
    return f'''location = {prefix} {{ return 308 {prefix}/; }}
location = {prefix}/_gateway_health {{ default_type text/plain; return 200 '{app['id']}'; }}
location ^~ {prefix}/ {{
  proxy_pass http://127.0.0.1:{app['port']}/;
  proxy_http_version 1.1;
  proxy_set_header Host 127.0.0.1:{app['port']};
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $app_connection;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Prefix {prefix};
  proxy_buffering off;
  proxy_read_timeout 3600s;
  proxy_redirect ~^(/.*)$ {prefix}$1;
  proxy_cookie_path / {prefix}/;
  {compatibility}
}}
'''


def nginx(*args):
    result = subprocess.run([NGINX, '-p', str(STATE) + '/', '-c', str(STATE / 'nginx.conf'),
                             *args], capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise RuntimeError('Nginx configuration/start failed: ' + result.stderr[-1200:])


def initialize():
    if os.geteuid() == 0:
        user = pwd.getpwnam('byclaw')
        STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chown(STATE, user.pw_uid, user.pw_gid)
        subprocess.run(['runuser', '-u', 'byclaw', '--', sys.executable, __file__, 'init'],
                       check=True)
        return
    for name in ('routes', 'client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'):
        (STATE / name).mkdir(parents=True, exist_ok=True, mode=0o700)
    config = STATE / 'nginx.conf'
    if not config.exists():
        config.write_text(base_config(port_number(os.environ.get('BYCLAW_APP_PORT', '8082'))))
    nginx('-t')
    pid_file = STATE / 'nginx.pid'
    running = False
    try:
        pid = int(pid_file.read_text().strip())
        os.kill(pid, 0)
        running = True
    except (OSError, ValueError):
        pass
    if not running:
        with (STATE / 'startup.log').open('ab') as log:
            process = subprocess.Popen(
                [NGINX, '-p', str(STATE) + '/', '-c', str(config), '-g', 'daemon off;'],
                stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        for _ in range(40):
            if process.poll() is not None:
                raise RuntimeError('Nginx exited; inspect ' + str(STATE / 'startup.log'))
            if pid_file.exists() and pid_file.read_text().strip():
                break
            time.sleep(.05)
        else:
            raise RuntimeError('Nginx did not create its PID file')
    print(json.dumps({'gateway': 'ready', 'stateDirectory': str(STATE)}))


@contextmanager
def locked():
    if not (STATE / 'nginx.conf').is_file():
        raise RuntimeError('Preview gateway is not initialized')
    with (STATE / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def ready(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f'http://127.0.0.1:{port}/', timeout=3) as response:
            return 200 <= response.status < 400
    except (OSError, urllib.error.URLError):
        return False


def wait_route(app_id, present):
    port = port_number(os.environ.get('BYCLAW_APP_PORT', '8082'))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    url = f'http://127.0.0.1:{port}/a/{app_id}/_gateway_health'
    for _ in range(60):
        try:
            with opener.open(url, timeout=1) as response:
                active = response.status == 200 and response.read().decode() == app_id
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            active = False
        if active == present:
            return
        time.sleep(.05)
    raise RuntimeError('Nginx route reload did not become effective')


def address(sandbox_id, domain, port, app_id, public_base=''):
    sandbox_id = sandbox_id.rsplit('--', 1)[-1]
    if not re.fullmatch(r'sbx-[a-zA-Z0-9-]{8,100}', sandbox_id):
        raise ValueError('Pass the sandboxId from the current sandbox_acquire lease')
    if public_base:
        base = urlsplit(public_base)
        if (base.scheme not in ('http', 'https') or not base.hostname or base.username
                or base.password or base.query or base.fragment):
            raise ValueError('Public base must be an HTTP(S) URL without credentials/query/fragment')
        return f'{public_base.rstrip("/")}/{sandbox_id}/a/{app_id}/'
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', domain) or '.' not in domain:
        raise ValueError('Application domain must be a hostname without a scheme or path')
    return f'https://{port}-{sandbox_id}.{domain}/a/{app_id}/'


def load_apps():
    path = STATE / 'apps.json'
    return json.loads(path.read_text()) if path.exists() else {}


def save_apps(apps):
    path = STATE / 'apps.json.tmp'
    path.write_text(json.dumps(apps, indent=2) + '\n')
    path.replace(STATE / 'apps.json')


def expose(args):
    if not ready(args.port):
        raise RuntimeError('Application is not ready; start it before exposing its port')
    if args.port in (8080, 8081, int(os.environ.get('BYCLAW_APP_PORT', '8082')), 2222):
        raise ValueError('Choose an application port, not a transport/desktop/gateway port')
    with locked():
        apps = load_apps()
        previous = apps.get(args.name)
        app = {'id': previous['id'] if previous else secrets.token_hex(16),
               'name': args.name, 'port': args.port}
        gateway_port = port_number(os.environ.get('BYCLAW_APP_PORT', '8082'))
        app['url'] = address(args.sandbox_id, args.domain, gateway_port, app['id'], args.public_base)
        app['browserReady'] = bool(args.public_base) or not args.domain.endswith('aliyuncs.com')
        path = STATE / 'routes' / (args.name + '.conf')
        old_config = path.read_text() if path.exists() else None
        path.write_text(route_config(app))
        try:
            nginx('-t')
            nginx('-s', 'reload')
            wait_route(app['id'], True)
        except Exception:
            if old_config is None:
                path.unlink()
            else:
                path.write_text(old_config)
            raise
        apps[args.name] = app
        save_apps(apps)
    result = dict(app, status='ready', lifetime='current sandbox instance')
    if not app['browserReady']:
        result['notice'] = 'Default Aliyun domain may download HTML; configure BYCLAW_APP_DOMAIN for browser access.'
    print(json.dumps(result, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('init')
    expose_parser = commands.add_parser('expose')
    expose_parser.add_argument('--name', required=True)
    expose_parser.add_argument('--port', type=port_number, required=True)
    expose_parser.add_argument('--sandbox-id', default=os.environ.get('E2B_SANDBOX_ID'))
    expose_parser.add_argument('--domain', default=os.environ.get('BYCLAW_APP_DOMAIN', DEFAULT_DOMAIN))
    expose_parser.add_argument('--public-base', default=os.environ.get('BYCLAW_APP_PUBLIC_BASE', ''))
    commands.add_parser('list')
    remove = commands.add_parser('remove')
    remove.add_argument('--name', required=True)
    args = parser.parse_args()
    if hasattr(args, 'name') and not re.fullmatch(r'[a-z][a-z0-9-]{0,47}', args.name):
        raise ValueError('Application name must match [a-z][a-z0-9-]{0,47}')
    if args.command == 'init':
        initialize()
    elif args.command == 'expose':
        if not args.sandbox_id:
            raise ValueError('--sandbox-id is required; use sandbox_acquire.sandboxId')
        expose(args)
    elif args.command == 'list':
        with locked():
            print(json.dumps([dict(app, status='ready' if ready(app['port']) else 'stopped')
                              for app in load_apps().values()], ensure_ascii=False))
    else:
        with locked():
            apps = load_apps()
            if args.name in apps:
                app_id = apps[args.name]['id']
                (STATE / 'routes' / (args.name + '.conf')).unlink()
                nginx('-t')
                nginx('-s', 'reload')
                wait_route(app_id, False)
                del apps[args.name]
                save_apps(apps)
        print(json.dumps({'removed': args.name, 'applicationStopped': False}))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
