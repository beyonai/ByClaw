#!/usr/bin/env python3
"""Install locked npm payloads without lifecycle scripts or registry fallbacks."""
import argparse
import base64
import hashlib
import hmac
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, build_opener


def validate_url(url):
    parsed = urlsplit(url)
    host = parsed.hostname or ''
    if (parsed.scheme != 'https' or parsed.username or parsed.password
            or not (host == 'npmmirror.com' or host.endswith('.npmmirror.com'))):
        raise ValueError('Codex artifacts must use the configured domestic mirror')
    return url


class DomesticRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def verify_archive(archive, integrity):
    if not integrity.startswith('sha512-'):
        raise ValueError('A SHA-512 integrity value is required')
    expected = base64.b64decode(integrity.removeprefix('sha512-'), validate=True)
    with archive.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha512').digest()
    if not hmac.compare_digest(actual, expected):
        raise ValueError('Codex artifact integrity mismatch')


def extract_package(archive, destination, version):
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or '..' in path.parts or '\\' in member.name
                    or not path.parts or path.parts[0] != 'package'
                    or not (member.isfile() or member.isdir())):
                raise ValueError('Unsafe Codex package member')
        metadata = json.load(source.extractfile('package/package.json'))
        if metadata.get('name') != '@openai/codex' or metadata.get('version') != version:
            raise ValueError('Codex package name or version mismatch')
        for member in members:
            relative = PurePosixPath(member.name).parts[1:]
            target = destination.joinpath(*relative)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as incoming, target.open('wb') as output:
                    shutil.copyfileobj(incoming, output)
                target.chmod(member.mode & 0o755)


def install(release, prefix, artifacts=None):
    version = release['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or release['platform'] != 'linux-x64':
        raise ValueError('Only a pinned linux-x64 release is supported')
    packages = release['packages']
    if [(p['directory'], p['version']) for p in packages] != [
            ('codex', version), ('codex-linux-x64', version + '-linux-x64')]:
        raise ValueError('Both locked Codex packages are required')
    if prefix.exists():
        raise ValueError('Codex installation prefix must not already exist')
    for package in packages:
        validate_url(package['url'])
    prefix.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='codex-install-', dir=prefix.parent) as raw:
        stage = Path(raw)
        payload = stage / 'payload'
        for package in packages:
            filename = PurePosixPath(urlsplit(package['url']).path).name
            archive = stage / filename
            if artifacts is not None:
                shutil.copyfile(artifacts / filename, archive)
            else:
                opener = build_opener(DomesticRedirects())
                with opener.open(package['url'], timeout=120) as response:
                    validate_url(response.geturl())
                    with archive.open('wb') as output:
                        shutil.copyfileobj(response, output)
            verify_archive(archive, package['integrity'])
            destination = payload / 'node_modules' / '@openai' / package['directory']
            extract_package(archive, destination, package['version'])
        native = payload / 'node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex'
        launcher = payload / 'node_modules/@openai/codex/bin/codex.js'
        if not native.is_file() or not launcher.is_file():
            raise ValueError('Codex executable is missing from locked packages')
        (payload / 'bin').mkdir()
        (payload / 'bin/codex').symlink_to('../node_modules/@openai/codex/bin/codex.js')
        payload.rename(prefix)
    print('Installed Codex ' + version + ' from verified domestic artifacts')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--prefix', type=Path, required=True)
    parser.add_argument('--artifacts-dir', type=Path, help='Use only predownloaded locked files')
    args = parser.parse_args()
    try:
        install(json.loads(args.release.read_text(encoding='utf-8')), args.prefix, args.artifacts_dir)
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        parser.exit(1, 'Codex installation failed: ' + str(error) + '\n')
