#!/usr/bin/env python3
"""Exercise the real prepare entrypoint against fresh and existing persistent homes."""
import os
from pathlib import Path
import subprocess
import tempfile

entrypoint = Path(__file__).resolve().parent.parent / 'docker-entrypoint.sh'
with tempfile.TemporaryDirectory(prefix='byclaw-module-layout-') as directory:
    root = Path(directory).resolve()
    managed, home = root / 'image', root / 'persistent'
    profile = managed / 'profiles/web'
    for path in [managed / 'plugins', managed / 'skills', profile / 'node_modules', managed / 'profiles/node_modules']:
        path.mkdir(parents=True, exist_ok=True)
    (profile / 'package.json').write_text('{"name":"image-profile"}')
    (profile / 'cordis.patch.yml').write_text('# image default\n')
    (managed / 'profiles/node_modules/image-marker').write_text('built dependency')
    persistent = home / 'profiles/web'
    persistent.mkdir(parents=True)
    (persistent / 'cordis.patch.yml').write_text('# user patch must survive\n')
    (home / 'credentials.yaml').write_text('test fixture, not a credential')
    (home / 'profiles/node_modules').mkdir()
    (home / 'profiles/node_modules/old-marker').write_text('old generated cache')
    (persistent / '.dsh-module-fallback/node_modules').mkdir(parents=True)
    env = {**os.environ, 'BYCLAW_DSH_PREPARE_ONLY': '1', 'BYCLAW_DSH_PREPARED': '0',
           'DSH_HOME': str(home), 'BYCLAW_DSH_MANAGED_HOME': str(managed)}
    for attempt in range(2):
        subprocess.run(['bash', str(entrypoint)], env=env, check=True, capture_output=True)
        assert not (managed / 'profiles/node_modules').is_symlink(), 'image fallback must never point back to NAS'
        assert (home / 'profiles/node_modules').is_symlink(), 'generated fallback must be local'
        assert (home / 'profiles/node_modules').resolve() == managed / 'profiles/node_modules'
        assert (persistent / '.dsh-module-fallback').resolve() == profile / '.dsh-module-fallback'
        assert (persistent / 'node_modules').resolve() == profile / 'node_modules'
        assert (managed / 'profiles/node_modules/image-marker').read_text() == 'built dependency'
        assert (persistent / 'cordis.patch.yml').read_text() == '# user patch must survive\n'
        assert (home / 'credentials.yaml').read_text() == 'test fixture, not a credential'
print('local module layout: migration, persistence and repeated preparation passed')
