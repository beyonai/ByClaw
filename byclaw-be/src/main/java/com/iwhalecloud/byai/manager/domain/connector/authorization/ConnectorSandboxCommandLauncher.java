package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;

/** Runs connector authorization as the workspace owner, without changing the platform executor. */
public final class ConnectorSandboxCommandLauncher {
    public enum Profile { WECOM, LARK, DWS }

    // /by is a runtime-owned mount/symlink. Pin private paths with directory descriptors;
    // repair only known CLI files and never rewrite encryption keys or follow links.
    private static final String SCRIPT = """
        import os, re, stat, sys
        root = '/by'
        profile, operation = sys.argv[1:3]
        if profile not in ('wecom', 'lark', 'dws') or operation not in ('prepare', 'run', 'revoke'):
            raise RuntimeError('Invalid connector operation')
        if operation == 'revoke' and profile != 'wecom':
            raise RuntimeError('Invalid connector revoke operation')
        opened = []
        def keep(fd):
            opened.append(fd)
            return fd
        try:
            workspace = keep(os.open(root, os.O_RDONLY | os.O_DIRECTORY))
            owner = os.fstat(workspace)
            uid, gid = owner.st_uid, owner.st_gid
            privileged = os.geteuid() == 0
            if not privileged and (os.geteuid() != uid or os.getegid() != gid):
                raise RuntimeError('Connector execution identity mismatch')
            def directory(parent, name, optional=False):
                if optional:
                    try:
                        os.stat(name, dir_fd=parent, follow_symlinks=False)
                    except FileNotFoundError:
                        return None
                else:
                    try:
                        os.mkdir(name, 0o700, dir_fd=parent)
                    except FileExistsError:
                        pass
                fd = keep(os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent))
                if os.fstat(fd).st_uid not in (0, uid):
                    raise RuntimeError('Connector private directory owner mismatch')
                if privileged:
                    os.fchown(fd, uid, gid)
                os.fchmod(fd, 0o700)
                return fd
            def private_file(parent, name):
                try:
                    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                except FileNotFoundError:
                    return
                try:
                    info = os.fstat(fd)
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid not in (0, uid):
                        raise RuntimeError('Invalid connector private file')
                    if privileged:
                        os.fchown(fd, uid, gid)
                    os.fchmod(fd, 0o600)
                finally:
                    os.close(fd)
            def private_files(parent, pattern):
                for name in os.listdir(parent):
                    if re.fullmatch(pattern, name):
                        private_file(parent, name)
            def fixed_environment(name, expected):
                value = os.environ.get(name)
                if value and os.path.normpath(value) != expected:
                    raise RuntimeError('Connector private path override is not supported: ' + name)
            name = {'wecom': '.wecom-cli', 'lark': '.lark-cli', 'dws': '.dws'}[profile]
            home_path = root + '/.connector-auth/' + name
            if os.environ.get('HOME') != home_path:
                raise RuntimeError('Connector HOME mismatch')
            fixed_environment({'wecom': 'WECOM_HOME', 'lark': 'LARK_HOME', 'dws': 'DWS_HOME'}[profile], home_path)
            if profile == 'wecom':
                fixed_environment('WECOM_CLI_CONFIG_DIR', home_path + '/.config/wecom')
            elif profile == 'lark':
                fixed_environment('LARKSUITE_CLI_CONFIG_DIR', home_path + '/.lark-cli')
                fixed_environment('LARKSUITE_CLI_DATA_DIR', home_path + '/.local/share')
                if os.environ.get('LARKSUITE_CLI_LOG_DIR'):
                    raise RuntimeError('Connector private log path override is not supported')
            else:
                fixed_environment('DWS_CONFIG_DIR', home_path + '/config')
                if os.environ.get('DWS_DISABLE_KEYCHAIN') != '1':
                    raise RuntimeError('DWS private file keychain is required')
            shared = directory(workspace, '.connector-auth')
            home = directory(shared, name)
            if profile == 'wecom':
                config = directory(directory(home, '.config'), 'wecom')
                for name in ('.encryption_key', 'credentials.enc', 'bot.enc', 'token.enc', 'config.json'):
                    private_file(config, name)
            elif profile == 'lark':
                # Linux lark-cli 1.0.x stores its keychain separately from config.
                config = directory(home, '.lark-cli')
                def lark_config(fd):
                    private_file(fd, 'config.json')
                    locks = directory(fd, 'locks')
                    private_files(locks, r'refresh_[A-Za-z0-9._-]+\\.lock')
                    scopes = directory(directory(fd, 'cache'), 'auth_login_scopes')
                    private_files(scopes, r'[A-Za-z0-9._-]+\\.json')
                    logs = directory(fd, 'logs')
                    private_files(logs, r'auth-[0-9]{4}-[0-9]{2}-[0-9]{2}\\.log')
                lark_config(config)
                for name in ('openclaw', 'hermes', 'lark-channel'):
                    child = directory(config, name, optional=True)
                    if child is not None:
                        lark_config(child)
                keychain = directory(directory(directory(home, '.local'), 'share'), 'lark-cli')
                private_file(keychain, 'master.key')
                private_files(keychain, r'[A-Za-z0-9._-]+\\.enc')
            else:
                # DWS profiles/recovery and file-DEK slots have dynamic names. Limit
                # repair to its two private trees, preserving data and lock inodes.
                remaining = [10000]
                def dws_private_tree(parent, depth=0):
                    if depth > 32:
                        raise RuntimeError('DWS private directory nesting limit exceeded')
                    with os.scandir(parent) as entries:
                        for entry in entries:
                            remaining[0] -= 1
                            if remaining[0] < 0:
                                raise RuntimeError('DWS private file limit exceeded')
                            if entry.is_dir(follow_symlinks=False):
                                child = directory(parent, entry.name)
                                try:
                                    dws_private_tree(child, depth + 1)
                                finally:
                                    opened.remove(child)
                                    os.close(child)
                            else:
                                private_file(parent, entry.name)
                dws_private_tree(directory(home, 'config'))
                keychain = directory(directory(directory(home, '.local'), 'share'), 'dws-cli')
                dws_private_tree(keychain)
                os.umask(0o077)
            if privileged:
                os.setgroups([])
                os.setgid(gid)
                os.setuid(uid)
            if operation == 'revoke':
                for name in ('bot.enc', 'token.enc', 'credentials.enc'):
                    try:
                        os.unlink(name, dir_fd=config)
                    except FileNotFoundError:
                        pass
            elif operation == 'run':
                argv = sys.argv[3:]
                if not argv:
                    raise RuntimeError('Missing connector command')
                os.execvpe(argv[0], argv, os.environ)
        finally:
            for fd in reversed(opened):
                os.close(fd)
        """;

    private ConnectorSandboxCommandLauncher() { }

    public static SandboxCommandRequest wrap(Profile profile, SandboxCommandRequest request) {
        Objects.requireNonNull(request, "request");
        return new SandboxCommandRequest(argv(profile, "run", request.argv()), request.environment(),
            request.workingDirectory(), request.timeout(), request.maxOutputBytes(), request.background());
    }

    public static List<String> prepare(Profile profile) {
        return argv(profile, "prepare", List.of());
    }

    public static List<String> revokeWecom() {
        return argv(Profile.WECOM, "revoke", List.of());
    }

    private static List<String> argv(Profile profile, String operation, List<String> command) {
        Objects.requireNonNull(profile, "profile");
        List<String> argv = new ArrayList<>(List.of("python3", "-c", SCRIPT,
            switch (profile) {
                case WECOM -> "wecom";
                case LARK -> "lark";
                case DWS -> "dws";
            }, operation));
        argv.addAll(command);
        return List.copyOf(argv);
    }
}
