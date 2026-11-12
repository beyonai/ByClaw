#!/bin/sh
# byclaw-tool-workload COMMAND [ARGS...]: run one tool command as a workload.
#
# A starts every process on the tool sandbox (B) through this wrapper when B has it.
# It moves itself into the `work` cgroup and raises its own OOM score, both of which
# the command inherits, then execs the command in place (same PID, no extra process).
# Either step may fail (an older image, a read-only cgroup tree); the command runs anyway.
# The isolation file is written by byclaw-tool-base-entrypoint; read it without forking.
state="${BYCLAW_TOOL_ISOLATION_FILE:-/run/byclaw-tool-sandbox/isolation}"
if [ $# -eq 0 ]; then
    echo 'usage: byclaw-tool-workload COMMAND [ARGS...]' >&2
    exit 2
fi
work=
oom=
if [ -r "${state}" ]; then
    while IFS='=' read -r key value; do
        case "${key}" in
            work) work="${value}" ;;
            oom) oom="${value}" ;;
        esac
    done <"${state}"
fi
if [ -n "${work}" ]; then
    { echo "$$" >"${work}/cgroup.procs"; } 2>/dev/null || :
fi
case "${oom}" in
    ''|*[!0-9-]*) ;;
    *)
        current=
        { read -r current </proc/$$/oom_score_adj; } 2>/dev/null || :
        case "${current}" in
            ''|*[!0-9-]*) ;;
            *) if [ "${current}" -lt "${oom}" ]; then { echo "${oom}" >/proc/$$/oom_score_adj; } 2>/dev/null || :; fi ;;
        esac
        ;;
esac
exec "$@"
