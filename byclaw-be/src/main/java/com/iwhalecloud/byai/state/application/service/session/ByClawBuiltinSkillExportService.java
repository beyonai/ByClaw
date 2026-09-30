package com.iwhalecloud.byai.state.application.service.session;

import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandExecutor;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import org.springframework.stereotype.Service;

/** 从当前用户的 OpenClaw 镜像读取完整内置技能，不用资源描述伪造 SKILL.md。 */
@Service
public class ByClawBuiltinSkillExportService {
    private static final int MAX_PACKAGE_BYTES = 64 * 1024 * 1024;

    // 固定程序与独立 argv 参数，不拼接 shell。打包时保留脚本执行权限并展开镜像内依赖链接。
    private static final String EXPORT_SCRIPT = """
        import base64, io, pathlib, sys, zipfile
        root = pathlib.Path('/app/skills').resolve()
        skill = (root / sys.argv[1]).resolve()
        if skill.parent != root or not (skill / 'SKILL.md').is_file():
            raise ValueError('Skill files unavailable')
        buf = io.BytesIO()
        total = 0
        def add_tree(path, name, ancestors, archive):
            global total
            resolved = path.resolve(strict=True)
            if resolved.is_dir():
                if resolved in ancestors:
                    raise ValueError('Cyclic skill dependency')
                for child in sorted(resolved.iterdir()):
                    add_tree(child, name + '/' + child.name, ancestors | {resolved}, archive)
            elif resolved.is_file():
                total += resolved.stat().st_size
                if total > 64 * 1024 * 1024:
                    raise ValueError('Skill package too large')
                archive.write(resolved, name)
            else:
                raise ValueError('Unsupported skill file')
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as archive:
            add_tree(skill, sys.argv[1], set(), archive)
        if buf.tell() > 64 * 1024 * 1024:
            raise ValueError('Skill package too large')
        print(base64.b64encode(buf.getvalue()).decode('ascii'))
        """;

    private final SandboxCommandExecutor executor;
    private final UserSandboxResolver sandboxResolver;

    public ByClawBuiltinSkillExportService(SandboxCommandExecutor executor, UserSandboxResolver sandboxResolver) {
        this.executor = executor;
        this.sandboxResolver = sandboxResolver;
    }

    public byte[] exportPackage(String userCode, String skillCode) {
        if (userCode == null || userCode.isBlank() || skillCode == null
            || !skillCode.matches("[A-Za-z0-9][A-Za-z0-9._-]*")) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
        }
        try {
            String sandboxId = sandboxResolver.resolve(userCode, "openclaw").sandboxId();
            var result = executor.run(sandboxId, new SandboxCommandRequest(
                List.of("python3", "-c", EXPORT_SCRIPT, skillCode), Map.of(), null,
                Duration.ofMinutes(2), (MAX_PACKAGE_BYTES / 3 + 1) * 4 + 1024, false));
            if (result == null || result.exitCode() != 0 || result.timedOut() || result.truncated()
                || result.stdout() == null || result.stdout().isBlank()) {
                throw new IllegalStateException("Incomplete built-in skill export");
            }
            byte[] bytes = Base64.getDecoder().decode(result.stdout().trim());
            if (bytes.length < 4 || bytes.length > MAX_PACKAGE_BYTES || bytes[0] != 'P' || bytes[1] != 'K') {
                throw new IllegalStateException("Invalid built-in skill package");
            }
            return bytes;
        }
        catch (RuntimeException e) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.builtin.export.failed"), e);
        }
    }
}
