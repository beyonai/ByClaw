"""Check install dependencies; engines and peers describe compatibility ranges."""

import json
from pathlib import Path
import re
import subprocess
import sys


def violations(package):
    for section in ("dependencies", "devDependencies", "optionalDependencies"):
        for name, version in package.get(section, {}).items():
            if re.match(r"^[~^]", version):
                yield f"{section}.{name}: {version}"


def main():
    paths = sys.argv[1:] or subprocess.check_output(
        ["git", "ls-files", "-z", "*package.json"], text=True
    ).strip("\0").split("\0")
    failed = False
    for name in paths:
        path = Path(name)
        # Fixture manifests deliberately include invalid JSON and sample ranges.
        if {"tests", "__tests__", "fixtures", ".scratch"}.intersection(path.parts):
            continue
        if not path.is_file():
            continue
        for error in violations(json.loads(path.read_text())):
            print(f"{path}: {error}")
            failed = True
    if not failed:
        print("Package dependency version pinning passed")
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
