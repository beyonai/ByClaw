#!/usr/bin/env python3
"""Linux image smoke test: real Chromium/byCLI activate on the first private request."""
import json
import os
from pathlib import Path
import pwd
import subprocess
import tempfile
import time


def wait_for(path, process, timeout=90):
    end = time.monotonic() + timeout
    while not path.exists():
        if process.poll() is not None or time.monotonic() > end:
            raise AssertionError(f'on-demand verification failed waiting for {path.name}')
        time.sleep(.05)


def main():
    account = pwd.getpwnam('byclaw')
    with tempfile.TemporaryDirectory(prefix='bod-', dir='/tmp') as directory:
        root = Path(directory)
        os.chown(root, account.pw_uid, account.pw_gid)
        child = root/'client.py'
        child.write_text('''import json, os, pathlib, socket, time
root=pathlib.Path(os.environ['VERIFY_ROOT'])
fd=int(os.environ.pop('BYCLAW_BROWSER_SECRET_FD'))
secret=os.read(fd,512).decode();os.close(fd)
(root/'dsh-ready').touch()
while not (root/'go').exists(): time.sleep(.02)
with socket.socket(socket.AF_UNIX) as client:
    client.settimeout(90)
    client.connect(os.environ['BYCLAW_BROWSER_SOCKET'])
    client.sendall((json.dumps({'type':'status','requestId':'verify','secret':secret})+'\\n').encode())
    data=b''
    while b'\\n' not in data: data+=client.recv(65536)
    response=json.loads(data.split(b'\\n')[0])
    assert response['type']=='ok', response.get('type')
(root/'request-ok').touch()
while True: time.sleep(.1)
''')
        child.chmod(0o755)
        socket_path=root/'browser.sock'
        env=dict(os.environ, VERIFY_ROOT=str(root), BYCLAW_BROWSER_STARTUP='on-demand',
                 BYCLAW_BROWSER_USER_DATA_DIR=str(root/'profile'),
                 BYCLAW_BROWSER_SESSION_RUNTIME_ROOT=str(root/'desktop'),
                 BYCLAW_BROWSER_VIEWER='shared-novnc', BYCLAW_BYCLI_ENABLED='true',
                 BYCLAW_BROWSER_GENERATION_FILE=str(root/'generation.json'))
        process=subprocess.Popen(['/usr/local/bin/byclaw-browser-supervisor', '--socket-path', str(socket_path),
                                  '--readiness-timeout', '60', '--', 'python3', str(child)], env=env,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try:
            wait_for(root/'dsh-ready', process)
            assert not (root/'generation.json').exists(), 'Chrome started before browser use'
            assert not Path(str(socket_path)+'.activated').exists()
            start=time.monotonic();(root/'go').touch()
            wait_for(root/'request-ok', process)
            wait_for(Path(str(socket_path)+'.activated'), process)
            generation=json.loads((root/'generation.json').read_text())
            assert generation['generation'] >= 1
            print(json.dumps({'privateRequest':'ok','bycliBridge':'ready','firstUseSeconds':round(time.monotonic()-start,3)}))
        finally:
            process.terminate()
            _,stderr=process.communicate(timeout=20)
            if process.returncode not in (0,143): print(stderr[-3000:])
        assert not socket_path.exists(), 'private socket survived shutdown'
        if 'generation' in locals() and generation.get('pid'):
            assert not Path(f"/proc/{generation['pid']}").exists(), 'Chrome survived supervisor shutdown'


if __name__=='__main__': main()
