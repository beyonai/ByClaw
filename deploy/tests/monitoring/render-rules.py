#!/usr/bin/env python3
"""Extract the actual shell-generated rule file for promtool regression tests."""
import re
import sys
import textwrap
from pathlib import Path

source = Path(sys.argv[1]).read_text()
start = source.index("    groups:\n      - name: byclaw.sandbox.autoscale")
end = min(pos for marker in ("\n---", "\nEOF") if (pos := source.find(marker, start)) >= 0)
rules = textwrap.dedent(source[start:end])
rules = re.sub(r"\$\{([A-Z_]+)(?::-([^}]*))?\}",
               lambda m: "by-service" if m[1] == "OPENSANDBOX_WORKLOAD_NAMESPACE" else m[2] or "", rules)
rules = rules.replace(r"\$", "$")
Path(sys.argv[2]).write_text(rules + "\n")
