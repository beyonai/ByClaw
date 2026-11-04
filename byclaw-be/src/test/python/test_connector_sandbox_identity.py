#!/usr/bin/env python3
"""Isolated Linux/root regression for the production connector identity launcher.

Run from any directory; the default source is resolved relative to this file.
No real /by directory, credentials, or network service is accessed.

For a standalone Linux host, copy this fixture plus the Java source and set
BYCLAW_CONNECTOR_LAUNCHER_SOURCE to the copied Java file. Alternatively export
only the launcher with --export-launcher /tmp/connector-launcher.py, transfer
both Python files, and set BYCLAW_CONNECTOR_LAUNCHER_SCRIPT to that exported file.
The two override variables are mutually exclusive; exports are generated from
production source, never maintained as another implementation in this repository.
"""

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import textwrap


DEFAULT_SOURCE = (
    pathlib.Path(__file__).resolve().parent
    / "../../../src/main/java/com/iwhalecloud/byai/manager/domain/connector/authorization"
    / "ConnectorSandboxCommandLauncher.java"
)


def load_launcher():
    script_path = os.environ.get("BYCLAW_CONNECTOR_LAUNCHER_SCRIPT")
    source_path = os.environ.get("BYCLAW_CONNECTOR_LAUNCHER_SOURCE")
    if script_path and source_path:
        raise ValueError("Specify only one launcher script/source override")
    if script_path:
        script = pathlib.Path(script_path).read_text(encoding="utf-8")
    else:
        source = pathlib.Path(source_path or DEFAULT_SOURCE).read_text(encoding="utf-8")
        match = re.search(
            r'private static final String SCRIPT = """\n(.*?)^[ \t]*""";',
            source,
            re.DOTALL | re.MULTILINE,
        )
        if not match:
            raise ValueError("Production Java SCRIPT text block was not found")
        block = textwrap.dedent(match.group(1))
        escapes = {"b": "\b", "t": "\t", "n": "\n", "f": "\f", "r": "\r",
                   '"': '"', "'": "'", "\\": "\\", "s": " ", "\n": ""}

        def decode_escape(match):
            value = match.group(1)
            if value not in escapes:
                raise ValueError("Unsupported Java text-block escape: " + repr(value))
            return escapes[value]

        script = re.sub(r"\\(.)", decode_escape, block, flags=re.DOTALL)
    compile(script, "production-connector-launcher", "exec")
    if script.count("root = '/by'") != 1:
        raise ValueError("Expected one production workspace binding; fixture must be updated")
    return script


def bind_workspace(launcher, workspace):
    return launcher.replace("root = '/by'", "root = " + repr(str(workspace)), 1)


def run_fixture(launcher):
    import pwd

    account = pwd.getpwnam('nobody')
    uid, gid = account.pw_uid, account.pw_gid
    assert uid > 0 and gid > 0
    checks = []
    with tempfile.TemporaryDirectory(prefix='byclaw-connector-identity-') as temporary:
        root = pathlib.Path(temporary)
        root.chmod(0o755)
        by = root / 'by'
        by.mkdir(mode=0o770)
        os.chown(by, uid, gid)
        shared = by / '.connector-auth'
        shared.mkdir(mode=0o700)
        sibling = shared / '.dws'
        sibling.mkdir(mode=0o700)
        (sibling / 'unrelated').write_text('unchanged')
        script = bind_workspace(launcher, by)
        def env_for(profile, target=by):
            env = dict(os.environ)
            for name in ('LARKSUITE_CLI_CONFIG_DIR','LARKSUITE_CLI_DATA_DIR','LARKSUITE_CLI_LOG_DIR','LARK_HOME','WECOM_HOME','WECOM_CLI_CONFIG_DIR','DWS_HOME','DWS_CONFIG_DIR'):
                env.pop(name, None)
            env['HOME'] = str(target / '.connector-auth' / {'wecom': '.wecom-cli', 'lark': '.lark-cli', 'dws': '.dws'}[profile])
            if profile == 'dws':
                env['DWS_DISABLE_KEYCHAIN'] = '1'
            return env
        def call(profile, mode, *argv):
            return subprocess.run([sys.executable, '-c', script, profile, mode, *argv], env=env_for(profile), capture_output=True, text=True, timeout=30)
        for profile, files in [
            ('wecom', ['.config/wecom/.encryption_key','.config/wecom/credentials.enc','.config/wecom/bot.enc','.config/wecom/token.enc','.config/wecom/config.json']),
            ('lark', ['.lark-cli/config.json','.lark-cli/locks/refresh_app_user.lock','.lark-cli/cache/auth_login_scopes/app_user.json','.lark-cli/logs/auth-2026-11-04.log','.lark-cli/openclaw/config.json','.lark-cli/openclaw/locks/refresh_app_user.lock','.local/share/lark-cli/master.key','.local/share/lark-cli/appsecret_app.enc','.local/share/lark-cli/app_user.enc']),
            ('dws', ['config/profiles.json','config/recovery/events/one.json','.local/share/dws-cli/master.key','.local/share/dws-cli/auth-token.enc','.local/share/dws-cli/.data.lock'])
        ]:
            home = pathlib.Path(env_for(profile)['HOME'])
            for name in files:
                file = home / name
                file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                file.write_text('fixture-' + name)
                file.chmod(0o600)
                current = file.parent
                while current != by:
                    current.chmod(0o700)
                    current = current.parent
            identities = {name: (home / name).stat().st_ino for name in files}
            result = call(profile, 'run', sys.executable, '-c', "import json,os,pathlib; home=pathlib.Path(os.environ['HOME']);(home/'written-by-cli').write_text('yes');print(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'groups':os.getgroups()}))")
            assert result.returncode == 0, result.stderr
            assert json.loads(result.stdout) == dict(uid=uid, gid=gid, groups=[]), result.stdout
            assert (home / 'written-by-cli').stat().st_uid == uid
            assert shared.stat().st_uid == uid and shared.stat().st_mode & 0o777 == 0o700
            assert sibling.stat().st_uid == (uid if profile == 'dws' else 0)
            assert (sibling / 'unrelated').stat().st_uid == 0 and (sibling / 'unrelated').read_text() == 'unchanged'
            for name in files:
                file = home / name
                assert file.stat().st_uid == uid and file.stat().st_gid == gid
                assert file.stat().st_mode & 0o777 == 0o600
                assert file.stat().st_ino == identities[name] and file.read_text() == 'fixture-' + name
            checks.append(profile + ': root-owned paths repaired; command uid/gid/groups; keys/locks preserved; sibling untouched')
        config = by / '.connector-auth/.wecom-cli/.config/wecom'
        result = call('wecom', 'revoke')
        assert result.returncode == 0, result.stderr
        assert all(not (config / name).exists() for name in ['credentials.enc','bot.enc','token.enc'])
        assert (config / '.encryption_key').read_text() == 'fixture-.config/wecom/.encryption_key'
        assert (config / 'config.json').exists()
        checks.append('wecom: revoke keeps key/config')
        for profile, file in [('wecom',config / 'credentials.enc'),('lark',by / '.connector-auth/.lark-cli/.local/share/lark-cli/master.key'),('dws',by / '.connector-auth/.dws/.local/share/dws-cli/auth-token.enc')]:
            if file.exists(): file.unlink()
            outside = root / ('outside-' + profile)
            outside.write_text('outside-fixture')
            outside.chmod(0o600)
            file.symlink_to(outside)
            assert call(profile, 'prepare').returncode != 0
            assert outside.stat().st_uid == 0 and outside.read_text() == 'outside-fixture'
            file.unlink()
            os.link(outside, file)
            assert call(profile, 'prepare').returncode != 0
            assert outside.stat().st_uid == 0
            file.unlink()
            file.write_text('foreign-fixture')
            foreign_uid = 1 if uid != 1 else 2
            os.chown(file, foreign_uid, 1)
            assert call(profile, 'prepare').returncode != 0
            assert file.stat().st_uid == foreign_uid and file.read_text() == 'foreign-fixture'
            file.unlink()
            checks.append(profile + ': symlink/hardlink/foreign owner rejected without changing target')
        for profile, directory in [('wecom',config),('lark',by / '.connector-auth/.lark-cli/.local/share/lark-cli'),('dws',by / '.connector-auth/.dws/config')]:
            preserved = directory.with_name('preserved')
            directory.rename(preserved)
            directory.symlink_to(preserved)
            assert call(profile, 'prepare').returncode != 0
            directory.unlink()
            preserved.rename(directory)
            checks.append(profile + ': private directory symlink rejected')
        root_by = root / 'root-by'
        root_by.mkdir(mode=0o700)
        root_script = bind_workspace(launcher, root_by)
        for profile in ['wecom','lark','dws']:
            result = subprocess.run([sys.executable, '-c', root_script, profile, 'run', sys.executable, '-c', 'import os;print(os.getuid())'], env=env_for(profile,root_by), capture_output=True, text=True, timeout=30)
            assert result.returncode == 0 and result.stdout.strip() == '0', result.stderr
        checks.append('root-owned workload remains supported for all profiles')
    print(json.dumps(dict(result='PASS',count=len(checks),checks=checks), indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-launcher", type=pathlib.Path,
                        help="Export current production script for standalone Linux transfer")
    args = parser.parse_args()
    if args.export_launcher:
        args.export_launcher.write_text(load_launcher(), encoding="utf-8")
        print("Exported production launcher:", args.export_launcher)
        return 0
    if not sys.platform.startswith("linux") or os.geteuid() != 0:
        print("SKIP: connector identity regression requires Linux and root")
        return 0
    run_fixture(load_launcher())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
