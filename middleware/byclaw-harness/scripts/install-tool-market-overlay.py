"""Install a source-built plugin payload while retaining the selected image's SDK."""
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile

PACKAGE_NAME = '@byclaw/dsh-tool-env'


def validate_archive(archive: Path) -> None:
    seen = set()
    total = 0
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if len(members) > 2000:
            raise ValueError('Plugin archive has too many entries')
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or member.name in seen:
                raise ValueError('Unsafe or duplicate plugin archive path')
            seen.add(member.name)
            if not (member.isfile() or member.isdir()) or any(part.startswith('.') or part == 'node_modules' for part in path.parts):
                raise ValueError('Plugin archive contains a link, special file or private data')
            if path.parts[0] not in {'package.json', 'cordis.patch.yml', 'lib', 'scripts', 'README.md', 'README.zh.md'}:
                raise ValueError('Unexpected plugin archive payload')
            if path.parts[0] not in {'lib', 'scripts'} and (len(path.parts) != 1 or not member.isfile()):
                raise ValueError('Invalid plugin metadata entry')
            if member.mode & 0o7000:
                raise ValueError('Privileged plugin archive mode')
            total += member.size
            if total > 32 * 1024 * 1024:
                raise ValueError('Plugin archive is too large')
        if 'package.json' not in seen or 'lib/index.js' not in seen:
            raise ValueError('Plugin archive lacks its package or compiled entry')
        stream = tar.extractfile('package.json')
        if stream is None or json.load(stream).get('name') != PACKAGE_NAME:
            raise ValueError('Unexpected plugin package identity')


def remove_owned_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def replace_payload(root: Path, archive: Path) -> None:
    validate_archive(archive)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Installed plugin root must be an image-owned directory')
    # Preserve node_modules only. Stale compiled modules/scripts must never survive an upgrade.
    for name in ('lib', 'scripts', 'package.json', 'cordis.patch.yml', 'README.md', 'README.zh.md'):
        remove_owned_path(root / name)
    with tarfile.open(archive, 'r:gz') as tar:
        tar.extractall(root)


def bind_dependency(root: Path, name: str, target: Path) -> None:
    link = root / 'node_modules' / name
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.resolve() == target.resolve():
        return
    remove_owned_path(link)
    link.symlink_to(target)


def package_root(entry: Path, name: str) -> Path:
    for candidate in [entry, *entry.parents]:
        manifest = candidate / 'package.json'
        if manifest.is_file():
            try:
                if json.loads(manifest.read_text()).get('name') == name:
                    return candidate
            except (json.JSONDecodeError, OSError):
                pass
    raise ValueError(f'Cannot locate declared dependency root: {name}')


def install() -> None:
    profile = Path('/opt/byclaw/dsh-managed/profiles/web/node_modules')
    roots = [profile / PACKAGE_NAME, Path('/opt/byclaw/dsh-managed/plugins/byclaw--dsh-tool-env')]
    archive = Path('/tmp/byclaw-tool-catalog-plugin.tgz')
    validate_archive(archive)
    for root in roots:
        if json.loads((root / 'package.json').read_text()).get('name') != PACKAGE_NAME:
            raise ValueError('Installed base plugin identity mismatch')
    script = "const r=require('module').createRequire('/workspace/apps/cli/package.json');console.log(r.resolve('@deepseek-ai/dsh-tools'))"
    tools = package_root(Path(subprocess.check_output(['node', '-e', script], text=True).strip()), '@deepseek-ai/dsh-tools')
    for root in roots:
        replace_payload(root, archive)
        bind_dependency(root, '@deepseek-ai/dsh-tools', tools)
        bind_dependency(root, '@deepseek-ai/dsh-subprocess-ssh', profile / '@deepseek-ai/dsh-subprocess-ssh')
    # Canonical package resolution must use the actual profile/CLI closure, never local SDK copies.
    package = json.loads((roots[0] / 'package.json').read_text())
    names = sorted(set(package.get('dependencies', {})) | set(package.get('peerDependencies', {})))
    script = "const r=require('module').createRequire(" + json.dumps(str(roots[0] / 'package.json')) + ");console.log(JSON.stringify(" + json.dumps(names) + ".map(name=>({name,path:r.resolve(name)}))))"
    for item in json.loads(subprocess.check_output(['node', '-e', script], text=True)):
        bind_dependency(roots[1], item['name'], package_root(Path(item['path']), item['name']))
    for root in roots:
        script = 'const m=await import(' + json.dumps(str(root / 'lib/index.js')) + ');if(typeof m.ToolEnv!=="function"||typeof m.ToolSandboxManager!=="function")process.exit(1)'
        subprocess.run(['node', '--input-type=module', '-e', script], check=True)
    print(json.dumps({'installed': True, 'paths': [str(root) for root in roots]}))


if __name__ == '__main__':
    install()
