#!/usr/bin/env python3
"""List and explicitly initialize bundled application templates; never install packages."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

TEMPLATES = Path('/opt/byclaw/templates')


def template(identifier):
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,47}', identifier):
        raise ValueError('Invalid template identifier')
    root = TEMPLATES / identifier
    manifest = json.loads((root / 'template.json').read_text())
    if manifest['id'] != identifier or manifest['schemaVersion'] != 1:
        raise ValueError('Unsupported template manifest')
    return root, manifest


def main(args=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('list')
    for action in ('init', 'run', 'repair', 'migrate-dependencies'):
        command = commands.add_parser(action)
        command.add_argument('template')
        if action == 'run':
            command.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args(args)
    if args.command == 'list':
        print(json.dumps([template(p.parent.name)[1]
                          for p in sorted(TEMPLATES.glob('*/template.json'))], ensure_ascii=False))
        return 0
    root, manifest = template(args.template)
    if args.command not in manifest['commands']:
        raise ValueError('Template does not support this operation')
    arguments = getattr(args, 'arguments', [])
    if arguments[:1] == ['--']:
        arguments = arguments[1:]
    return subprocess.call([sys.executable, str(root / 'workspace.py'),
                            args.command, *arguments])


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1) from None
