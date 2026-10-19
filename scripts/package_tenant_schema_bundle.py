#!/usr/bin/env python3
"""Package explicit tenant DDL and a separately captured catalog without connecting to a database.

The runtime Node validator remains authoritative for executable SQL. Capture provenance is
published beside the two-entry bundle so a target protocol never misrepresents the test engine.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import tempfile
import zipfile

CATALOG_KEYS = {'objects', 'columns', 'indexes', 'constraints', 'sequences'}
CORE_TABLES = {'byai_session', 'byai_message', 'byai_session_member',
               'byai_group_chat_forward_request', 'byai_group_chat_forward_target',
               'byai_group_chat_forward_item'}
IDENTIFIER = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
VERSION = re.compile(r'^V[0-9]+(?:\.[0-9]+)*$')


def canonical(value):
    # Catalog query results contain strings, booleans and null; do not coerce bigint strings.
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def package(args):
    if not VERSION.fullmatch(args.version):
        raise ValueError('invalid explicit version')
    if args.kind == 'update' and not args.parent_version:
        raise ValueError('--parent-version is required for update')
    if args.kind == 'baseline' and args.parent_version:
        raise ValueError('baseline cannot have a parent-version')
    if args.parent_version and (not VERSION.fullmatch(args.parent_version) or args.parent_version == args.version):
        raise ValueError('invalid parent-version')
    sql = args.source.read_bytes()
    text = sql.decode('utf-8')
    if not text.strip() or b'\0' in sql or len(sql) > 8 * 1024 * 1024:
        raise ValueError('invalid SQL input')
    capture = json.loads(args.catalog.read_text(encoding='utf-8'))
    if capture.get('formatVersion') != 1 or capture.get('engineName') not in ('PostgreSQL', 'openGauss') or not capture.get('engineVersion'):
        raise ValueError('actual capture engine/version is required')
    if capture.get('sourceSqlSha256') != digest(sql):
        raise ValueError('catalog source SQL hash mismatch')
    catalog = capture.get('catalog')
    if not isinstance(catalog, dict) or set(catalog) != CATALOG_KEYS or any(not isinstance(v, list) for v in catalog.values()):
        raise ValueError('complete five-result catalog required')
    objects = []
    seen = set()
    for row in catalog['objects']:
        kind = {'r': 'table', 'p': 'table', 'i': 'index', 'I': 'index', 'S': 'sequence'}.get(row.get('kind'))
        name = row.get('name', '')
        if not kind or not IDENTIFIER.fullmatch(name) or name in seen:
            raise ValueError('unsupported or duplicate catalog object')
        seen.add(name)
        objects.append({'kind': kind, 'name': name})
    if not objects:
        raise ValueError('empty catalog')
    if args.kind == 'baseline':
        # This completeness check supplements, rather than replaces, the runtime AST validator.
        tables = {o['name'] for o in objects if o['kind'] == 'table'}
        sequences = {o['name'] for o in objects if o['kind'] == 'sequence'}
        declarations = lambda kind: set(re.findall(r'(?im)^CREATE\s+' + kind + r'\s+(?:IF\s+NOT\s+EXISTS\s+)?byai\.([A-Za-z_][A-Za-z0-9_]*)\s', text))
        if not CORE_TABLES <= tables or tables != declarations('TABLE') or sequences != declarations('SEQUENCE'):
            raise ValueError('source is not a complete tenant baseline')
    elif capture.get('parentMarker', {}).get('version') != args.parent_version:
        raise ValueError('parent-version does not match observed parent marker')
    manifest = {'version': args.version, 'parentVersion': args.parent_version,
                'engine': 'openGauss', 'nodeProtocol': {'min': 1, 'max': 1},
                'sqlSha256': digest(sql), 'catalogDigest': digest(canonical(catalog)), 'objects': objects}
    manifest_bytes = canonical(manifest) + b'\n'
    prefix = f"{'baseline' if args.kind == 'baseline' else 'versions'}/{args.version}"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in [('__ddl.sql', sql), ('manifest.json', manifest_bytes)]:
            entry = zipfile.ZipInfo(f'{prefix}/{name}', date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, content, compresslevel=9)
    bundle = buffer.getvalue()
    if len(bundle) > 8 * 1024 * 1024 or len(sql) + len(manifest_bytes) > 32 * 1024 * 1024:
        raise ValueError('bundle exceeds runtime limits')
    provenance = {'formatVersion': 1, 'version': args.version, 'kind': args.kind,
                  'captureEngine': {'name': capture['engineName'], 'version': capture['engineVersion']},
                  'targetProtocol': 'openGauss', 'targetEngineVerified': False,
                  'sqlSha256': digest(sql), 'catalogDigest': manifest['catalogDigest'],
                  'bundleSha256': digest(bundle), 'parentMarker': capture.get('parentMarker'),
                  'catalog': catalog}
    outputs = {args.output: bundle,
               args.output.with_name(args.output.stem + '__manifest.json'): manifest_bytes,
               args.output.with_name(args.output.stem + '__provenance.json'): canonical(provenance) + b'\n'}
    # Prevalidate every destination before writing; existing different artifacts are never overwritten.
    for path, content in outputs.items():
        if path.is_symlink() or (path.exists() and path.read_bytes() != content):
            raise ValueError(f'refusing different existing output: {path.name}')
    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            continue
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
            pending = Path(handle.name)
            handle.write(content)
        try:
            pending.replace(path)
        finally:
            pending.unlink(missing_ok=True)
    return {'version': args.version, 'kind': args.kind, 'bundleSha256': digest(bundle),
            'catalogDigest': manifest['catalogDigest']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--kind', choices=('baseline', 'update'), required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--parent-version')
    args = parser.parse_args()
    try:
        print(json.dumps(package(args), sort_keys=True))
    except (ValueError, TypeError, KeyError, OSError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
