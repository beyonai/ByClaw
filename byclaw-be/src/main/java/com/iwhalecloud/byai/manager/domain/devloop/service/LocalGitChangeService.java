package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 本地 git 工作区变更服务
 * 直接读取宿主机上会话工作区的 git 仓库,跑 git diff 拿本地分支变更(含未 push、未 commit 的改动)。
 * 补 GitHubCompareService 只能覆盖远程已 push 分支的短板;工作区路径由 DevloopApplicationService 按 NFS 规律拼好传入。
 */
@Slf4j
@Service
public class LocalGitChangeService {

    /** 单条 git 命令最长等待秒数,防止卡死拖垮请求线程。 */
    private static final int GIT_TIMEOUT_SECONDS = 20;

    /** git 空树对象哈希(恒定值):基线分支不存在时对它 diff,把 HEAD 已提交内容全列为新增。它是 tree 非 commit。 */
    private static final String EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

    /** 本地变更结果状态:闭合取值,前端据此区分空态。 */
    public enum LocalStatus {
        /** 成功取到本地变更 */
        OK,
        /** 工作区目录不存在(会话还没 clone,或后端读不到 NFS) */
        NO_WORKSPACE,
        /** 目录存在但不是 git 仓库 */
        NOT_GIT_REPO,
        /** 执行 git 命令失败 */
        GIT_ERROR
    }

    /** 单个文件变更。字段与 GitHubCompareService.FileChange 对齐,便于前端统一渲染。 */
    @Getter
    public static class LocalFileChange {
        private final String filename;
        private final String status;
        private final int additions;
        private final int deletions;
        private final String previousFilename;

        public LocalFileChange(String filename, String status, int additions, int deletions, String previousFilename) {
            this.filename = filename;
            this.status = status;
            this.additions = additions;
            this.deletions = deletions;
            this.previousFilename = previousFilename;
        }
    }

    /** 本地变更结果:状态 + 分支 + 文件变更。 */
    @Getter
    public static class LocalChangeResult {
        private final LocalStatus status;
        private final String baseBranch;
        private final String headBranch;
        private final List<LocalFileChange> files;
        private final String message;

        private LocalChangeResult(LocalStatus status, String baseBranch, String headBranch, List<LocalFileChange> files,
            String message) {
            this.status = status;
            this.baseBranch = baseBranch;
            this.headBranch = headBranch;
            this.files = files;
            this.message = message;
        }

        static LocalChangeResult ok(String base, String head, List<LocalFileChange> files) {
            return new LocalChangeResult(LocalStatus.OK, base, head, files, null);
        }

        static LocalChangeResult fail(LocalStatus status, String base, String head, String message) {
            return new LocalChangeResult(status, base, head, new ArrayList<>(), message);
        }
    }

    /**
     * 收集工作区相对基线分支的本地变更(已 commit 的 diff + 未 commit 的工作区改动一并计入)。
     * @param workspaceDir 会话工作区里仓库的绝对路径(如 {nfs}/{bucket}/by/.sessions/{sessionId}/{repo})
     * @param baseBranch   基线分支(默认 main)
     */
    public LocalChangeResult collectChanges(Path workspaceDir, String baseBranch) {
        if (workspaceDir == null) {
            return LocalChangeResult.fail(LocalStatus.NO_WORKSPACE, baseBranch, null,
                I18nUtil.get("devloop.git.workspace.path.empty"));
        }

        // 全程兜底:目录检查到 git 执行的任何异常都收敛为结果状态,绝不抛给上层/前端。
        try {
            File dir = workspaceDir.toFile();
            if (!dir.isDirectory()) {
                return LocalChangeResult.fail(LocalStatus.NO_WORKSPACE, baseBranch, null,
                    I18nUtil.get("devloop.git.workspace.not.found"));
            }
            if (!new File(dir, ".git").exists()) {
                return LocalChangeResult.fail(LocalStatus.NOT_GIT_REPO, baseBranch, null,
                    I18nUtil.get("devloop.git.workspace.not.repository"));
            }

            String headBranch = runGit(dir, "rev-parse", "--abbrev-ref", "HEAD").trim();
            // worktree 比较基线按约定依次取上游、reflog 起点和 main，保证未配置远端跟踪的临时分支也能展示改动。
            String baseRef = resolveBaseRef(dir, baseBranch);

            // 已 commit:base...HEAD 的累计增删行;未 commit:工作区相对 HEAD 的改动。两者按文件名合并,未提交优先。
            Map<String, LocalFileChange> merged = new LinkedHashMap<>();
            collectNumstat(dir, baseRef, merged);
            collectWorkingTree(dir, merged);

            return LocalChangeResult.ok(baseRef, headBranch, new ArrayList<>(merged.values()));
        }
        catch (Exception e) {
            log.warn("[Devloop] 本地 git 变更采集失败 dir={}", workspaceDir, e);
            return LocalChangeResult.fail(LocalStatus.GIT_ERROR, baseBranch, null,
                I18nUtil.get("devloop.git.command.failed", e.getMessage()));
        }
    }

    /** 单文件 diff 结果:状态 + unified diff 文本。 */
    @Getter
    public static class FileDiffResult {
        private final LocalStatus status;
        private final String filename;
        private final String diff;
        private final String message;

        private FileDiffResult(LocalStatus status, String filename, String diff, String message) {
            this.status = status;
            this.filename = filename;
            this.diff = diff;
            this.message = message;
        }
    }

    /**
     * 取单个文件相对基线的 unified diff 文本(含已提交与未提交改动),供前端 modal 逐行渲染红绿。
     * 与 collectChanges 同口径解析基线;全程兜底,任何异常收敛为状态,不抛上层。
     */
    public FileDiffResult fileDiff(Path workspaceDir, String baseBranch, String filePath) {
        if (workspaceDir == null || filePath == null || filePath.trim().isEmpty()) {
            return new FileDiffResult(LocalStatus.NO_WORKSPACE, filePath, null,
                I18nUtil.get("devloop.git.diff.parameters.required"));
        }
        try {
            File dir = workspaceDir.toFile();
            if (!dir.isDirectory()) {
                return new FileDiffResult(LocalStatus.NO_WORKSPACE, filePath, null,
                    I18nUtil.get("devloop.git.workspace.not.found"));
            }
            if (!new File(dir, ".git").exists()) {
                return new FileDiffResult(LocalStatus.NOT_GIT_REPO, filePath, null,
                    I18nUtil.get("devloop.git.workspace.not.repository"));
            }
            String baseRef = resolveBaseRef(dir, baseBranch);
            // git diff 不会为未跟踪文件生成内容；Changes 列表虽已列出 A 文件，预览时需要与空文件比较。
            String workingStatus = runGit(dir, "status", "--porcelain", "-uall", "--", filePath);
            if (isAddedStatus(workingStatus)) {
                String diff = runGitAllowExitCode(dir, 1, "diff", "--no-index", "--", "/dev/null", filePath);
                return new FileDiffResult(LocalStatus.OK, filePath, diff, null);
            }
            // 单文件 diff:范围与列表一致,-- 后限定文件路径。已提交 + 未提交改动都会体现在 base..HEAD 与工作区叠加中,
            // 这里用 base 到工作区(不加 ...HEAD)一次性覆盖:git diff {base} -- {file} 比较基线与当前工作区。
            String diff = runGit(dir, "diff", baseRef, "--", filePath);
            if (diff.trim().isEmpty()) {
                // 基线到工作区无差异时,可能是文件仅在未提交暂存态;退而比较 HEAD 与工作区。
                diff = runGit(dir, "diff", "HEAD", "--", filePath);
            }
            return new FileDiffResult(LocalStatus.OK, filePath, diff, null);
        }
        catch (Exception e) {
            log.warn("[Devloop] 本地文件 diff 失败 dir={} file={}", workspaceDir, filePath, e);
            return new FileDiffResult(LocalStatus.GIT_ERROR, filePath, null,
                I18nUtil.get("devloop.git.command.failed", e.getMessage()));
        }
    }

    private boolean isAddedStatus(String status) {
        for (String line : status.split("\\R")) {
            if (line.startsWith("??") || line.startsWith("A ") || line.startsWith(" A")) {
                return true;
            }
        }
        return false;
    }

    /** 基线引用解析:优先当前分支上游，其次 reflog 创建起点，最后回退 main。 */
    private String resolveBaseRef(File dir, String baseBranch) {
        String upstream = resolveUpstream(dir);
        if (upstream != null) {
            return upstream;
        }

        String reflogBase = resolveReflogBase(dir);
        if (reflogBase != null) {
            return reflogBase;
        }

        String fallbackBranch = baseBranch == null || baseBranch.isBlank() ? "main" : baseBranch;
        String remoteMain = "origin/" + fallbackBranch;
        if (refExists(dir, remoteMain)) {
            return remoteMain;
        }
        if (refExists(dir, fallbackBranch)) {
            return fallbackBranch;
        }
        return EMPTY_TREE_HASH;
    }

    private String resolveUpstream(File dir) {
        if (!refExists(dir, "@{upstream}")) {
            return null;
        }
        try {
            String upstream = runGit(dir, "rev-parse", "--abbrev-ref", "--symbolic-full-name",
                "@{upstream}").trim();
            return upstream.isEmpty() ? null : upstream;
        }
        catch (Exception e) {
            return null;
        }
    }

    /** reflog 的最早提交通常就是 worktree 分支创建点；只有它与当前 HEAD 不同时才作为有效基线。 */
    private String resolveReflogBase(File dir) {
        try {
            String head = runGit(dir, "rev-parse", "HEAD").trim();
            String reflog = runGit(dir, "reflog", "show", "--format=%H", "HEAD");
            String oldestDistinct = null;
            for (String line : reflog.split("\\R")) {
                String candidate = line.trim();
                if (!candidate.isEmpty() && !candidate.equals(head)) {
                    oldestDistinct = candidate;
                }
            }
            return oldestDistinct;
        }
        catch (Exception e) {
            log.debug("[Devloop] worktree reflog 基线不可用 dir={}", dir, e);
        }
        return null;
    }

    /**
     * 构造 diff 范围:普通分支用 base...HEAD(基于 merge-base 的对称差,只算任务分支引入的改动);
     * 空树哈希是 tree 非 commit,不支持三点(merge-base)语法,必须用两点 base..HEAD 直接 diff。
     */
    private String diffRange(String baseRef) {
        return EMPTY_TREE_HASH.equals(baseRef) ? baseRef + "..HEAD" : baseRef + "...HEAD";
    }

    private boolean refExists(File dir, String ref) {
        try {
            Process p = newGit(dir, "rev-parse", "--verify", "--quiet", ref).start();
            boolean done = p.waitFor(GIT_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (!done) {
                p.destroyForcibly();
                return false;
            }
            return p.exitValue() == 0;
        }
        catch (Exception e) {
            return false;
        }
    }

    /**
     * git diff {base}...HEAD 的已提交变更:--name-status 拿变更类型(A/M/D/R),--numstat 拿增删行,按文件名合并。
     * numstat 本身不带类型,单用它所有文件都会被当成 modified,故必须叠加 name-status。
     */
    private void collectNumstat(File dir, String baseRef, Map<String, LocalFileChange> out) throws Exception {
        // 1) 类型 + 增删行分别取,再按新路径合并。
        Map<String, String> statusByFile = new LinkedHashMap<>();
        Map<String, String> previousByFile = new LinkedHashMap<>();
        String range = diffRange(baseRef);
        parseNameStatus(runGit(dir, "diff", "--name-status", "-M", range), statusByFile, previousByFile);

        String numstat = runGit(dir, "diff", "--numstat", "-M", range);
        for (String line : numstat.split("\n")) {
            String row = line.trim();
            if (row.isEmpty()) {
                continue;
            }
            // 格式: {additions}\t{deletions}\t{path};二进制文件增删列为 '-'。重命名时 path 形如 old => new。
            String[] parts = row.split("\t");
            if (parts.length < 3) {
                continue;
            }
            int additions = parseCount(parts[0]);
            int deletions = parseCount(parts[1]);
            String rawPath = parts[2];
            String filename = rawPath.contains("=>") ? normalizeRename(rawPath, false) : rawPath;
            String previousFilename = previousByFile.get(filename);
            // 类型以 name-status 为准;缺失(理论不会)兜底 modified。
            String status = statusByFile.getOrDefault(filename, "modified");
            out.put(filename, new LocalFileChange(filename, status, additions, deletions, previousFilename));
        }
    }

    /** 解析 git diff --name-status:首列状态码(A/M/D/R###/C###),映射为 added/modified/removed/renamed/copied。 */
    private void parseNameStatus(String output, Map<String, String> statusByFile, Map<String, String> previousByFile) {
        for (String line : output.split("\n")) {
            if (line.trim().isEmpty()) {
                continue;
            }
            String[] parts = line.split("\t");
            if (parts.length < 2) {
                continue;
            }
            char code = parts[0].charAt(0);
            switch (code) {
                case 'A':
                    statusByFile.put(parts[1], "added");
                    break;
                case 'D':
                    statusByFile.put(parts[1], "removed");
                    break;
                case 'R':
                    // R{score}\t{old}\t{new}
                    if (parts.length >= 3) {
                        statusByFile.put(parts[2], "renamed");
                        previousByFile.put(parts[2], parts[1]);
                    }
                    break;
                case 'C':
                    if (parts.length >= 3) {
                        statusByFile.put(parts[2], "copied");
                        previousByFile.put(parts[2], parts[1]);
                    }
                    break;
                default:
                    statusByFile.put(parts[1], "modified");
                    break;
            }
        }
    }

    /** git status --porcelain:补充未 commit 的工作区改动(新增/修改/删除/重命名),覆盖已 commit 的同名项。 */
    private void collectWorkingTree(File dir, Map<String, LocalFileChange> out) throws Exception {
        // -uall 禁止 Git 将未跟踪目录折叠成单行 ?? directory/，确保前端能看到目录下每个新增文件。
        String output = runGit(dir, "status", "--porcelain", "-uall");
        for (String line : output.split("\n")) {
            if (line.trim().isEmpty() || line.length() < 3) {
                continue;
            }
            // 前两位是暂存区/工作区状态码,第 3 位起是路径。
            String code = line.substring(0, 2).trim();
            String pathPart = line.substring(3).trim();
            String filename = pathPart;
            String previousFilename = null;
            String status;
            if (code.contains("R") && pathPart.contains(" -> ")) {
                String[] rename = pathPart.split(" -> ", 2);
                previousFilename = unquote(rename[0]);
                filename = unquote(rename[1]);
                status = "renamed";
            }
            else if (code.contains("D")) {
                filename = unquote(pathPart);
                status = "removed";
            }
            else if (code.equals("A") || code.contains("?")) {
                filename = unquote(pathPart);
                status = "added";
            }
            else {
                filename = unquote(pathPart);
                status = "modified";
            }
            // 未 commit 改动没有可靠的增删行统计,置 0;前端不展示 0 值,不影响观感。
            out.put(filename, new LocalFileChange(filename, status, 0, 0, previousFilename));
        }
    }

    private int parseCount(String token) {
        try {
            return "-".equals(token) ? 0 : Integer.parseInt(token.trim());
        }
        catch (NumberFormatException e) {
            return 0;
        }
    }

    /** 解析 numstat 的重命名路径 "a/{old => new}/b";wantOld=true 取旧路径,否则取新路径。 */
    private String normalizeRename(String rawPath, boolean wantOld) {
        int braceStart = rawPath.indexOf('{');
        int braceEnd = rawPath.indexOf('}');
        if (braceStart >= 0 && braceEnd > braceStart) {
            String prefix = rawPath.substring(0, braceStart);
            String suffix = rawPath.substring(braceEnd + 1);
            String inner = rawPath.substring(braceStart + 1, braceEnd);
            String[] sides = inner.split("=>");
            String side = wantOld ? sides[0] : sides[sides.length - 1];
            return (prefix + side.trim() + suffix).replaceAll("/+", "/");
        }
        // 无花括号:整体 old => new
        String[] sides = rawPath.split("=>");
        return (wantOld ? sides[0] : sides[sides.length - 1]).trim();
    }

    /** 去掉 git 对含特殊字符路径加的双引号包裹。 */
    private String unquote(String path) {
        String trimmed = path.trim();
        if (trimmed.length() >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
            return trimmed.substring(1, trimmed.length() - 1);
        }
        return trimmed;
    }

    /**
     * 在工作区目录同步执行一条 git 命令,超时强杀,返回 stdout 文本。
     * stderr 单独读取、不混入 stdout(否则 git 的 fatal 提示会被当成变更行解析);退出码非 0 时抛异常带上 stderr。
     */
    private String runGit(File dir, String... args) throws Exception {
        return runGitAllowExitCode(dir, 0, args);
    }

    /** 执行允许额外退出码的 git 命令；git diff --no-index 对有差异时约定返回 1。 */
    private String runGitAllowExitCode(File dir, int allowedExitCode, String... args) throws Exception {
        Process process = newGit(dir, args).start();
        // stdout 与 stderr 分开读:stdout 才是可解析数据,stderr 仅用于报错。
        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();
        try (BufferedReader out = new BufferedReader(
            new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
            BufferedReader err = new BufferedReader(
                new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = out.readLine()) != null) {
                stdout.append(line).append('\n');
            }
            while ((line = err.readLine()) != null) {
                stderr.append(line).append('\n');
            }
        }
        boolean finished = process.waitFor(GIT_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            throw new IllegalStateException(I18nUtil.get("devloop.git.command.timeout", String.join(" ", args)));
        }
        if (process.exitValue() != 0 && process.exitValue() != allowedExitCode) {
            // 非 0 退出(如 dubious ownership、非法 ref):抛异常带 stderr,由上层收敛为 GIT_ERROR,不把错误文本当数据。
            throw new IllegalStateException(I18nUtil.get("devloop.git.command.failed",
                "git " + String.join(" ", args) + ": " + stderr.toString().trim()));
        }
        return stdout.toString();
    }

    private ProcessBuilder newGit(File dir, String... args) {
        List<String> cmd = new ArrayList<>();
        cmd.add("git");
        // 绕过 dubious ownership:NFS 工作区属主(如 uid 999)与运行进程用户(容器内 appuser)常不一致,
        // 否则 git 拒绝在该目录操作。只读 diff/status 无写入风险,对全部路径放行。
        cmd.add("-c");
        cmd.add("safe.directory=*");
        for (String a : args) {
            cmd.add(a);
        }
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.directory(dir);
        return pb;
    }
}
