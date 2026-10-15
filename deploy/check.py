#!/usr/bin/env python3
"""Deployment checks including model requests and an expiring sandbox."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import uuid


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, timeout=15)


def selected(key, defaults):
    value = os.getenv(key, '')
    return [] if value == 'NONE' else (value.split(',') if value else defaults)


class Checker:
    def __init__(self, engine, timeout, deep=False):
        self.engine, self.timeout, self.deep = engine, timeout, deep
        self.results = []
        self.containers = {}
        self.spec_image = None
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def report(self, name, state, detail):
        self.results.append((name, state, detail))
        print(f'[{state}] {name}: {detail}', flush=True)

    def request(self, url, method='GET', data=None, headers=None):
        req = urllib.request.Request(url, method=method, headers=headers or {},
                                     data=json.dumps(data).encode() if data is not None else None)
        with self.http.open(req, timeout=10) as response:
            return response.status, response.read()

    def endpoint(self, service, port):
        info = self.containers.get(service, {})
        bindings = info.get('NetworkSettings', {}).get('Ports', {}).get(f'{port}/tcp') or []
        if not bindings:
            raise ValueError('no published port')
        binding = bindings[0]
        host = binding.get('HostIp') or '127.0.0.1'
        if host in ('0.0.0.0', '::'):
            host = '127.0.0.1'
        if ':' in host:
            host = f'[{host}]'
        return f'http://{host}:{binding["HostPort"]}'

    def discover(self, service, group):
        suffix = os.getenv('CONTAINER_SUFFIX', 'middleware' if group == 'middleware' else 'standalone')
        name = f'byclaw-{ "opensandbox" if service == "opensandbox-server" else service}-{suffix}'
        result = run(self.engine, 'inspect', name)
        if result.returncode:
            return False
        info = json.loads(result.stdout)[0]
        self.containers[service] = info
        return info.get('State', {}).get('Running', False)

    def exec(self, service, *args):
        return run(self.engine, 'exec', self.containers[service]['Id'], *args)

    def probe(self, service):
        if service == 'redis':
            # Pass configured authentication via stdin, never command arguments.
            password = os.getenv('REDIS_PASSWORD', '')
            result = subprocess.run([self.engine, 'exec', '-i', self.containers[service]['Id'],
                'sh', '-c', 'IFS= read -r REDISCLI_AUTH; export REDISCLI_AUTH; redis-cli ping'],
                input=password + '\n', capture_output=True, text=True, timeout=15)
            return result.returncode == 0 and result.stdout.strip() == 'PONG'
        if service == 'opengauss':
            result = run(self.engine, 'exec', '-u', 'omm', self.containers[service]['Id'],
                'bash', '-lc', 'gsql -h 127.0.0.1 -p "${GS_PORT:-5432}" '
                '-U "${GS_USERNAME:-gaussdb}" -W "$GS_PASSWORD" -d "${GS_DB:-postgres}" '
                '-At -v ON_ERROR_STOP=1 -c "SELECT 1 FROM byai.byai_system_config LIMIT 1"')
            return result.returncode == 0 and result.stdout.strip() == '1'
        ports = {'fe': (8080, '/beyond/'),
                 'be': (int(os.getenv('BE_SERVER_PORT', '8086')), '/byaiService/actuator/health'),
                 'qa-manager': (int(os.getenv('BYCLAW_QA_PORT', '8000')), '/health'),
                 'minio': (9000, '/minio/health/ready'),
                 'opensandbox-server': (9005, '/health')}
        if service not in ports:
            return self.containers[service].get('State', {}).get('Health', {}).get('Status') == 'healthy'
        port, path = ports[service]
        status, body = self.request(self.endpoint(service, port) + path)
        if service == 'be':
            return status == 200 and json.loads(body).get('status') == 'UP'
        return status == 200

    def application_dependencies(self):
        """Use the application's network and credentials without exposing them."""
        if 'qa-manager' not in self.containers:
            return
        script = r'''import json,os
out={}
try:
 import psycopg
 from psycopg import sql
except ImportError:
 out['database']='unsupported'
else:
 try:
  with psycopg.connect(host=os.getenv('DB_HOST'),port=os.getenv('DB_PORT','5432'),dbname=os.getenv('DB_DATABASE','postgres'),user=os.getenv('DB_USER'),password=os.getenv('DB_PASS'),connect_timeout=5) as conn:
   conn.execute('SET statement_timeout=5000')
   schema=sql.Identifier(os.getenv('DB_SCHEMA','byai'))
   conn.execute(sql.SQL('SELECT 1 FROM {}.byai_system_config LIMIT 1').format(schema)).fetchone()
   conn.execute(sql.SQL('SELECT enterprise_id FROM {}.byai_project LIMIT 0').format(schema))
   conn.execute(sql.SQL('SELECT 1 FROM {}.tenant_user_membership LIMIT 0').format(schema))
   out['database']='ok'
   row=conn.execute(sql.SQL("SELECT spec_json FROM {}.sandbox_service_spec WHERE service_key='openclaw'").format(schema)).fetchone()
   if row:
    spec=json.loads(row[0]) if isinstance(row[0],str) else row[0]
    out['image']=spec.get('image')
 except Exception:
  out['database']='failed'
try:
 import redis
except ImportError:
 out['redis']='unsupported'
else:
 try:
  if os.getenv('REDIS_MODE','standalone')=='cluster':
   out['redis']='unsupported'
  else:
   client=redis.Redis(host=os.getenv('REDIS_HOST','redis'),port=int(os.getenv('REDIS_PORT','6379')),username=os.getenv('REDIS_USERNAME') or None,password=os.getenv('REDIS_PASSWORD') or None,db=int(os.getenv('REDIS_DATABASE','0')),socket_connect_timeout=5,socket_timeout=5)
   out['redis']='ok' if client.ping() else 'failed'
 except Exception:
  out['redis']='failed'
print(json.dumps(out))
'''
        try:
            result = self.exec('qa-manager', 'sh', '-c',
                'if [ -x /app/.venv/bin/python ]; then exec /app/.venv/bin/python -c "$1"; '
                'else exec python -c "$1"; fi', 'deployment-check', script)
            if result.returncode:
                raise ValueError('dependency probe unavailable')
            data = json.loads(result.stdout)
            for key, name in [('database', '应用 → 数据库/必要字段'), ('redis', '应用 → Redis')]:
                state = {'ok': '通过', 'failed': '失败'}.get(data.get(key), '未验证')
                self.report(name, state, '从 QA 网络及其配置检查；失败时检查地址、认证、初始化及必要字段。')
            self.spec_image = data.get('image')
        except (OSError, ValueError, subprocess.TimeoutExpired):
            self.report('应用依赖', '未验证', 'QA 容器不具备检查运行环境，不能确认远端依赖可用。')

    def sandbox(self):
        configured = os.getenv('IMAGE_OPENCLAW', 'ghcr.io/beyonai/byclaw/byclaw-openclaw:latest')
        image = self.spec_image or configured
        if self.spec_image and self.spec_image != configured:
            self.report('OpenClaw 镜像规格', '失败', '数据库实际镜像与 IMAGE_OPENCLAW 不一致；本次按数据库规格检查，请统一配置。')
        # Inspect through the same Docker socket/client as OpenSandbox, not the host image store.
        script = ('import docker,sys; c=docker.from_env(); '
                  'i=c.images.get(sys.argv[1]); print(i.attrs.get("Architecture","unknown"))')
        result = self.exec('opensandbox-server', 'python', '-c', script, image)
        if result.returncode:
            self.report('OpenClaw 镜像', '失败', '沙箱引擎无法读取配置镜像；检查镜像是否已拉取及引擎连接。')
            return
        self.report('OpenClaw 镜像', '通过', '沙箱引擎可读取 .env 指定镜像。')
        if not self.spec_image:
            self.report('OpenClaw 数据库规格', '未验证', '无法读取数据库实际规格；本次仅检查 .env 镜像。')
        base = self.endpoint('opensandbox-server', 9005) + '/v1/sandboxes'
        headers = {'Content-Type': 'application/json',
                   'OPEN-SANDBOX-API-KEY': os.getenv('BYCLAW_SANDBOX_API_KEY', 'dev')}
        sid = None
        try:
            _, body = self.request(base, 'POST', {
                'image': {'uri': image}, 'resourceLimits': {'cpu': '500m', 'memory': '512Mi'},
                'entrypoint': ['/bin/sh', '-c', 'sleep 120'], 'timeout': 120,
                'metadata': {'purpose': 'deployment-check', 'checkId': str(uuid.uuid4())}}, headers)
            sid = json.loads(body)['id']
            script = '''import docker,sys
c=docker.from_env()
items=c.containers.list(filters={'label':'opensandbox.io/id='+sys.argv[1]})
assert len(items)==1
r=items[0].exec_run(['sh','-c','test -x /opt/opensandbox/execd && test -f /opt/opensandbox/bootstrap.sh'])
assert r.exit_code==0
'''
            result = self.exec('opensandbox-server', 'python', '-c', script, sid)
            if result.returncode:
                raise ValueError('runtime check failed')
            self.report('沙箱创建/execd', '通过', '临时容器运行且运行时文件已注入；未验证 OpenClaw 网关。')
        except Exception:
            self.report('沙箱创建/execd', '失败', '检查 OpenSandbox 创建日志、镜像架构及文件注入；临时沙箱设置 120 秒过期。')
        finally:
            if sid:
                try:
                    self.request(base + '/' + sid, 'DELETE', headers=headers)
                except Exception:
                    self.report('临时沙箱清理', '失败', f'请清理检查沙箱 {sid}；已设置 120 秒过期。')

    def models(self):
        if 'qa-manager' not in self.containers:
            self.report('LLM / Embedding', '失败', '缺少 QA 检查运行环境，无法验证模型调用。')
            return
        print('正在验证 LLM / Embedding：发送少量测试文本，可能产生少量模型费用。', flush=True)
        script = Path(__file__).with_name('check_models.py').read_text()
        try:
            result = subprocess.run([self.engine, 'exec', '-i', self.containers['qa-manager']['Id'],
                'sh', '-c', 'if [ -x /app/.venv/bin/python ]; then exec /app/.venv/bin/python -; else exec python -; fi'],
                input=script, capture_output=True, text=True, timeout=100)
            if result.returncode:
                raise ValueError()
            reports = json.loads(result.stdout)
            if len(reports) != 2:
                raise ValueError()
            for name, state, detail in reports:
                self.report(name, state, detail)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            self.report('LLM / Embedding', '失败', '模型检查超时或检查环境不可用。')

    def check(self):
        if run(self.engine, 'info').returncode:
            self.report('容器引擎', '失败', '引擎不可连接；请启动 Docker 或 Podman machine。')
            return 1
        groups = {'middleware': selected('MIDDLEWARE_MODULES', ['redis', 'minio', 'opengauss', 'opensandbox-server']),
                  'standalone': selected('STANDALONE_MODULES', ['fe', 'be', 'qa-manager'])}
        pending = {s.strip(): group for group, services in groups.items() for s in services if s.strip()}
        expected = set(pending)
        deadline = time.monotonic() + self.timeout
        while pending:
            for service, group in list(pending.items()):
                try:
                    if self.discover(service, group) and self.probe(service):
                        self.report(service, '通过', '基础就绪探测通过；不代表全部业务可用。')
                        del pending[service]
                except (OSError, ValueError, KeyError, subprocess.TimeoutExpired):
                    pass
                if time.monotonic() >= deadline:
                    break
            if not pending or time.monotonic() >= deadline:
                break
            time.sleep(2)
        for service in pending:
            if service == 'qa-manager' and service in self.containers:
                info = self.containers[service]
                started = info.get('State', {}).get('StartedAt')
                if started:
                    logs = run(self.engine, 'logs', '--since', started, '--tail', '200', info['Id'])
                    if 'ModelSetupRequiredError:' in logs.stdout + logs.stderr:
                        self.report(service, '待配置', '配置并调试默认 Embedding；当前知识库服务不可用。')
                        continue
            self.report(service, '失败', '等待就绪超时或容器缺失；检查对应启动日志、连接配置及初始化。')
        for service in ('opengauss', 'redis'):
            if service not in expected:
                self.report(service + ' 外置依赖', '未验证', '未选择本地容器；需验证应用配置的远端地址和认证。')
        if 'fe' in self.containers and 'be' in expected:
            try:
                status, body = self.request(self.endpoint('fe', 8080) + '/byaiService/actuator/health')
                assert status == 200 and json.loads(body).get('status') == 'UP'
                self.report('FE → BE', '通过', '前端代理可访问后端健康接口。')
            except Exception:
                self.report('FE → BE', '失败', '检查 Nginx 上游地址、容器 DNS 和 BE 就绪状态。')
        self.application_dependencies()
        if 'opensandbox-server' in expected and 'opensandbox-server' not in pending:
            self.sandbox()
        elif os.getenv('BYCLAW_SANDBOX_ENABLE', 'true') == 'true':
            self.report('沙箱依赖', '未验证', '沙箱服务未就绪或为外置服务。')
        self.models()
        if os.getenv('FILE_STORAGE_TYPE') == 'file' and 'minio' not in expected:
            self.report('MinIO', '不适用', '当前使用文件存储且未选择 MinIO。')
        failed = any(state in ('失败', '待配置') for _, state, _ in self.results)
        print('检查未通过，请处理上述失败项。' if failed else '基础检查通过；未验证项仍需验收，不能视为全部业务可用。')
        return 1 if failed else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--deep', action='store_true', help='兼容旧参数；所有检查默认包含模型调用和临时沙箱')
    parser.add_argument('--timeout', type=int, default=int(os.getenv('DEPLOY_CHECK_TIMEOUT', '120')))
    args = parser.parse_args()
    if args.timeout < 1:
        parser.error('timeout must be positive')
    engine = None
    for candidate in ('docker', 'podman'):
        try:
            if run(candidate, 'info').returncode == 0:
                engine = candidate
                break
        except (OSError, subprocess.TimeoutExpired):
            pass
    if not engine:
        print('[失败] 容器引擎不可连接；请启动 Docker 或 Podman machine。')
        return 1
    try:
        return Checker(engine, args.timeout, args.deep).check()
    except (OSError, ValueError, subprocess.TimeoutExpired):
        print('[失败] 检查无法完成；请确认引擎连接和配置格式。')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
