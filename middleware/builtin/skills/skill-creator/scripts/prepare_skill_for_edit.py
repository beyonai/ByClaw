#!/usr/bin/env python3
"""Copy an external Skill into the fixed workspace before editing it."""

import argparse
from pathlib import Path

from skill_workspace import copy_skill_for_edit


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="External Skill directory to copy")
    parser.add_argument("--name", help="Destination Skill name; defaults to source directory name")
    args = parser.parse_args()
    source = Path(args.source)
    name = args.name or source.name
    try:
        target = copy_skill_for_edit(source, name)
    except (FileExistsError, OSError, ValueError) as error:
        parser.error(str(error))
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
