#!/usr/bin/env python3
"""Compile repository TS against the selected Harness image's installed SDK, offline."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

PACKAGE_NAME = '@byclaw/dsh-tool-env'


def stage_source(source: Path, stage: Path) -> None:
    stage.mkdir(parents=True, exist_ok=False)
    for name in ('package.json', 'tsconfig.json', 'cordis.patch.yml'):
        path = source / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing regular source file: {name}')
        shutil.copy2(path, stage / name)
    if json.loads((stage / 'package.json').read_text())['name'] != PACKAGE_NAME:
        raise ValueError('Unexpected source package')
    ignore = shutil.ignore_patterns('node_modules', '.git', '.env*', '__pycache__', '*.pyc', '*.tgz')
    for name in ('src', 'scripts'):
        if (source / name).is_dir():
            if any(path.is_symlink() for path in (source / name).rglob('*') if 'node_modules' not in path.parts):
                raise ValueError(f'Source symlink is not permitted: {name}')
            shutil.copytree(source / name, stage / name, ignore=ignore)
    if not (stage / 'src/index.ts').is_file():
        raise ValueError('Plugin TypeScript entry is missing')


def link_installed_dependencies(stage: Path, dependency_package: Path, framework: Path) -> list:
    package = json.loads((stage / 'package.json').read_text())
    names = sorted(set().union(*(package.get(section, {}) for section in
                               ('dependencies', 'peerDependencies', 'devDependencies'))))
    # Profile dependencies win, particularly the version-matched subprocess SSH closure.
    # The CLI anchor exposes newly declared direct core dependencies, including dsh-tools.
    script = r'''
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const input=JSON.parse(process.argv[1]);
const anchors=input.anchors.map(p=>createRequire(p));
const rows=input.names.map(name=>{
 let root;
 for(const anchor of anchors){
  for(const key of [name+'/package.json',name]){
   try{
    let found=fs.realpathSync(anchor.resolve(key));
    found=fs.statSync(found).isDirectory()?found:path.dirname(found);
    while(found!==path.dirname(found)){
     const file=path.join(found,'package.json');
     if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).name===name){root=found;break}
     found=path.dirname(found);
    }
   }catch{}
   if(root)break;
  }
  if(root)break;
 }
 if(!root)throw Error('Installed base dependency missing: '+name);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 return {name,root,version:manifest.version};
});
process.stdout.write(JSON.stringify(rows));
'''
    anchors = [dependency_package / 'package.json', dependency_package.parents[1] / '_build-anchor.cjs',
               framework / 'apps/cli/package.json', framework / 'package.json']
    result = subprocess.run(['node', '-e', script, json.dumps({'names': names, 'anchors': [str(p) for p in anchors]})],
                            capture_output=True, text=True, check=True)
    rows = json.loads(result.stdout)
    for row in rows:
        link = stage / 'node_modules' / row['name']
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(Path(row['root']))
    return rows


def pack_plugin(source: Path, output: Path, framework: Path, dependency_package: Path) -> dict:
    compiler = framework / 'node_modules/typescript/bin/tsc'
    if not compiler.is_file() or not (dependency_package / 'package.json').is_file():
        raise ValueError('The selected Harness base must contain its compiler and installed plugin closure')
    with tempfile.TemporaryDirectory(prefix='byclaw-tool-market-source-') as raw:
        stage = Path(raw) / 'package'
        stage_source(source, stage)
        dependencies = link_installed_dependencies(stage, dependency_package, framework)
        # No npm/pnpm install, network downloads, or developer-machine SDK input.
        subprocess.run(['node', str(compiler), '--project', str(stage / 'tsconfig.json'),
                        '--typeRoots', str(stage / 'node_modules/@types')], cwd=stage, check=True)
        if not (stage / 'lib/index.js').is_file():
            raise ValueError('Compiler did not produce the plugin entry')
        output.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(output, 'w:gz', format=tarfile.PAX_FORMAT) as archive:
            for name in ('package.json', 'cordis.patch.yml', 'lib', 'scripts'):
                path = stage / name
                if path.exists():
                    archive.add(path, arcname=name, recursive=True)
        source_hash = hashlib.sha256()
        for path in sorted(stage.rglob('*')):
            if path.is_file() and 'node_modules' not in path.relative_to(stage).parts and 'lib' not in path.relative_to(stage).parts:
                source_hash.update(str(path.relative_to(stage)).encode()); source_hash.update(path.read_bytes())
        metadata = {'package': PACKAGE_NAME, 'sourceSha256': source_hash.hexdigest(),
                    'archiveSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                    'dependencies': [{'name': item['name'], 'version': item['version']} for item in dependencies],
                    'sdkSource': 'selected-harness-image-installed-closure', 'networkInstall': False}
        output.with_suffix(output.suffix + '.json').write_text(json.dumps(metadata, indent=2) + '\n')
        return metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--framework-root', type=Path, default=Path('/workspace'))
    parser.add_argument('--dependency-package', type=Path,
                        default=Path('/opt/byclaw/dsh-managed/profiles/web/node_modules/@byclaw/dsh-tool-env'))
    args = parser.parse_args()
    print(json.dumps(pack_plugin(args.source, args.output, args.framework_root, args.dependency_package)))


if __name__ == '__main__':
    main()
