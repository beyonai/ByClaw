package com.iwhalecloud.byai.manager.domain.devloop.service;

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
            return LocalChangeResult.fail(LocalStatus.NO_WORKSPACE, baseBranch, null, "工作区路径为空");
        }

        // 全程兜底:目录检查到 git 执行的任何异常都收敛为结果状态,绝不抛给上层/前端。
        try {
            File dir = workspaceDir.toFile();
            if (!dir.isDirectory()) {
                return LocalChangeResult.fail(LocalStatus.NO_WORKSPACE, baseBranch, null, "工作区目录不存在");
            }
            if (!new File(dir, ".git").exists()) {
                return LocalChangeResult.fail(LocalStatus.NOT_GIT_REPO, baseBranch, null, "工作区不是 git 仓库");
            }

            String headBranch = runGit(dir, "rev-parse", "--abbrev-ref", "HEAD").trim();
            // 基线以本地实际存在的为准:优先 origin/{base},回退本地 {base};都没有则对空树 diff,至少能列出全部文件。
            String baseRef = resolveBaseRef(dir, baseBranch);

            // 已 commit:base...HEAD 的累计增删行;未 commit:工作区相对 HEAD 的改动。两者按文件名合并,未提交优先。
            Map<String, LocalFileChange> merged = new LinkedHashMap<>();
            collectNumstat(dir, baseRef, merged);
            collectWorkingTree(dir, merged);

            return LocalChangeResult.ok(baseBranch, headBranch, new ArrayList<>(merged.values()));
        }
        catch (Exception e) {
            log.warn("[Devloop] 本地 git 变更采集失败 dir={}", workspaceDir, e);
            return LocalChangeResult.fail(LocalStatus.GIT_ERROR, baseBranch, null, e.getMessage());
        }
    }

    /** 基线引用解析:优先远程跟踪 origin/{base},其次本地 {base};都无则用 git 空树哈希(列全部文件为新增)。 */
    private String resolveBaseRef(File dir, String baseBranch) {
        String candidate = "origin/" + baseBranch;
        if (refExists(dir, candidate)) {
            return candidate;
        }
        if (refExists(dir, baseBranch)) {
            return baseBranch;
        }
        // git 空树对象哈希,恒定值;对它 diff 等于"相对空仓库",把工作区已 commit 内容全列为新增。
        return "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
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

    /** git diff --numstat {base}...HEAD:解析每个文件的增删行与重命名。 */
    private void collectNumstat(File dir, String baseRef, Map<String, LocalFileChange> out) throws Exception {
        String output = runGit(dir, "diff", "--numstat", "-M", baseRef + "...HEAD");
        for (String line : output.split("\n")) {
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
            String filename = rawPath;
            String previousFilename = null;
            String status = "modified";
            if (rawPath.contains("=>")) {
                // a/{old => new}/b 或 old => new,统一取箭头两侧拼出新旧路径。
                previousFilename = normalizeRename(rawPath, true);
                filename = normalizeRename(rawPath, false);
                status = "renamed";
            }
            out.put(filename, new LocalFileChange(filename, status, additions, deletions, previousFilename));
        }
    }

    /** git status --porcelain:补充未 commit 的工作区改动(新增/修改/删除/重命名),覆盖已 commit 的同名项。 */
    private void collectWorkingTree(File dir, Map<String, LocalFileChange> out) throws Exception {
        String output = runGit(dir, "status", "--porcelain");
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

    /** 在工作区目录同步执行一条 git 命令,合并 stderr,超时强杀,返回 stdout 文本。 */
    private String runGit(File dir, String... args) throws Exception {
        Process process = newGit(dir, args).start();
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append('\n');
            }
        }
        boolean finished = process.waitFor(GIT_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            throw new IllegalStateException("git 命令超时: " + String.join(" ", args));
        }
        return output.toString();
    }

    private ProcessBuilder newGit(File dir, String... args) {
        List<String> cmd = new ArrayList<>();
        cmd.add("git");
        for (String a : args) {
            cmd.add(a);
        }
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.directory(dir);
        pb.redirectErrorStream(true);
        return pb;
    }
}
