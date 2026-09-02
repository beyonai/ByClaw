package com.iwhalecloud.byai.manager.domain.project.service;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import com.alibaba.fastjson2.JSON;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Git 命令执行器
 *
 * 封装 Git 命令的执行逻辑，提供超时控制和错误处理
 */
@Slf4j
@Component
public class GitCommandExecutor {

    /**
     * 默认命令超时时间（5 分钟）
     */
    private static final long DEFAULT_TIMEOUT_SECONDS = 300;

    /**
     * Submodule 操作超时时间（10 分钟，因为需要克隆远程仓库）
     */
    private static final long SUBMODULE_TIMEOUT_SECONDS = 600;

    /**
     * 克隆操作超时时间（15 分钟，因为可能需要下载大量数据）
     */
    private static final long CLONE_TIMEOUT_SECONDS = 900;

    /**
     * 从 Redis 获取默认超时配置
     *
     * @return 超时时间（秒），如果未配置则返回默认值
     */
    private long getDefaultTimeout() {
        return getTimeoutFromRedis(RedisConfig.GIT_TIMEOUT_DEFAULT_PARAM_CODE, DEFAULT_TIMEOUT_SECONDS);
    }

    /**
     * 从 Redis 获取子模块超时配置
     *
     * @return 超时时间（秒），如果未配置则返回默认值
     */
    private long getSubmoduleTimeout() {
        return getTimeoutFromRedis(RedisConfig.GIT_TIMEOUT_SUBMODULE_PARAM_CODE, SUBMODULE_TIMEOUT_SECONDS);
    }

    /**
     * 从 Redis 获取克隆超时配置
     *
     * @return 超时时间（秒），如果未配置则返回默认值
     */
    private long getCloneTimeout() {
        return getTimeoutFromRedis(RedisConfig.GIT_TIMEOUT_CLONE_PARAM_CODE, CLONE_TIMEOUT_SECONDS);
    }

    /**
     * 从 Redis 读取超时配置
     *
     * @param paramCode 参数编码
     * @param defaultValue 默认值
     * @return 超时时间（秒）
     */
    private long getTimeoutFromRedis(String paramCode, long defaultValue) {
        try {
            String configJson = RedisUtil.hmGet(RedisConfig.SYSTEM_CONFIG_CODE_KEY, paramCode);
            if (configJson != null && !configJson.isEmpty()) {
                ByaiSystemConfig config = JSON.parseObject(configJson, ByaiSystemConfig.class);
                if (config != null && config.getParamValue() != null) {
                    long timeout = Long.parseLong(config.getParamValue());
                    if (timeout > 0) {
                        log.debug("Using Redis timeout config: {} = {} seconds", paramCode, timeout);
                        return timeout;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to read Git timeout config from Redis: {}, using default: {} seconds",
                paramCode, defaultValue, e);
        }
        return defaultValue;
    }

    /**
     * 执行 Git 命令（使用默认超时）
     *
     * @param repoPath Git 仓库路径
     * @param command Git 命令及参数
     * @return 命令的标准输出
     * @throws BaseException 如果命令执行失败或超时
     */
    public String executeCommand(Path repoPath, String... command) throws BaseException {
        return executeCommand(repoPath, getDefaultTimeout(), command);
    }

    /**
     * 执行 Git 命令（自定义超时）
     *
     * @param repoPath Git 仓库路径
     * @param timeoutSeconds 超时时间（秒）
     * @param command Git 命令及参数
     * @return 命令的标准输出
     * @throws BaseException 如果命令执行失败或超时
     */
    public String executeCommand(Path repoPath, long timeoutSeconds, String... command) throws BaseException {
        return executeCommand(repoPath, timeoutSeconds, true, command);
    }

    /**
     * 执行只读查询命令但不逐行记录标准输出，避免文件内容或大型目录树进入应用日志。
     */
    public String executeCommandQuietly(Path repoPath, String... command) throws BaseException {
        return executeCommand(repoPath, getDefaultTimeout(), false, command);
    }

    /** 执行可能返回二进制内容的只读命令，原样保留标准输出字节。 */
    public byte[] executeCommandBytesQuietly(Path repoPath, String... command) throws BaseException {
        ProcessBuilder processBuilder = new ProcessBuilder(command);
        processBuilder.directory(repoPath.toFile());
        processBuilder.redirectErrorStream(false);
        Process process = null;
        try {
            process = processBuilder.start();
            ByteArrayOutputStream stdout = new ByteArrayOutputStream();
            ByteArrayOutputStream stderr = new ByteArrayOutputStream();
            Thread stdoutReader = startBinaryOutputReader(process.getInputStream(), stdout);
            Thread stderrReader = startBinaryOutputReader(process.getErrorStream(), stderr);
            boolean completed = process.waitFor(getDefaultTimeout(), TimeUnit.SECONDS);
            if (!completed) {
                process.destroyForcibly();
                throw new BaseException(50500, "Git command timeout: " + String.join(" ", command));
            }
            stdoutReader.join(5000);
            stderrReader.join(5000);
            if (process.exitValue() != 0) {
                String error = new String(stderr.toByteArray(), StandardCharsets.UTF_8);
                throw new BaseException(50500, "Git command failed: " + sanitizeGitCredentials(error));
            }
            return stdout.toByteArray();
        }
        catch (IOException e) {
            throw new BaseException(50500, "Failed to execute Git command: " + e.getMessage(), e);
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (process != null) {
                process.destroyForcibly();
            }
            throw new BaseException(50500, "Git command interrupted: " + String.join(" ", command), e);
        }
    }

    private String executeCommand(Path repoPath, long timeoutSeconds, boolean logOutput, String... command)
        throws BaseException {
        ProcessBuilder processBuilder = new ProcessBuilder(command);
        processBuilder.directory(repoPath.toFile());
        processBuilder.redirectErrorStream(false);

        log.debug("Executing Git command in {}: {}", repoPath, String.join(" ", command));

        Process process = null;
        try {
            process = processBuilder.start();

            // 异步读取 stdout 和 stderr，防止缓冲区阻塞
            StringBuilder stdout = new StringBuilder();
            StringBuilder stderr = new StringBuilder();

            Thread stdoutReader = startOutputReader(process.getInputStream(), stdout, logOutput);
            Thread stderrReader = startOutputReader(process.getErrorStream(), stderr, logOutput);

            // 等待命令执行完成（带超时）
            boolean completed = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);

            if (!completed) {
                process.destroyForcibly();
                throw new BaseException(50500,
                    String.format("Git command timeout after %d seconds: %s",
                        timeoutSeconds, String.join(" ", command)));
            }

            // 等待输出读取完成
            stdoutReader.join(5000);
            stderrReader.join(5000);

            int exitCode = process.exitValue();
            String stdoutStr = stdout.toString();
            String stderrStr = stderr.toString();

            if (exitCode != 0) {
                // 过滤错误消息中的凭据信息
                String sanitizedStderr = sanitizeGitCredentials(stderrStr);
                throw new BaseException(50500,
                    String.format("Git command failed with exit code %d: %s\nStderr: %s",
                        exitCode, String.join(" ", command), sanitizedStderr));
            }

            log.debug("Git command succeeded: {}", String.join(" ", command));
            return stdoutStr;

        } catch (IOException e) {
            throw new BaseException(50500,
                "Failed to execute Git command: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (process != null) {
                process.destroyForcibly();
            }
            throw new BaseException(50500,
                "Git command interrupted: " + String.join(" ", command), e);
        }
    }

    /**
     * 执行需要长时间运行的 Git 子模块命令
     *
     * @param repoPath Git 仓库路径
     * @param command Git 命令及参数
     * @return 命令的标准输出
     * @throws BaseException 如果命令执行失败或超时
     */
    public String executeSubmoduleCommand(Path repoPath, String... command) throws BaseException {
        return executeCommand(repoPath, getSubmoduleTimeout(), command);
    }

    /**
     * 启动一个线程异步读取进程输出流
     *
     * 防止输出缓冲区满导致进程阻塞
     * 同时实时打印输出到日志（对大仓库克隆尤其重要）
     */
    private Thread startOutputReader(java.io.InputStream inputStream, StringBuilder output, boolean logOutput) {
        Thread thread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                    // 实时打印到日志（INFO 级别，便于观察大仓库克隆进度）
                    if (logOutput) {
                        log.info("Git output: {}", line);
                    }
                }
            } catch (IOException e) {
                log.warn("Error reading process output: {}", e.getMessage());
            }
        });
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private Thread startBinaryOutputReader(java.io.InputStream inputStream, ByteArrayOutputStream output) {
        Thread thread = new Thread(() -> {
            try (inputStream; output) {
                inputStream.transferTo(output);
            }
            catch (IOException e) {
                log.warn("Error reading git process output: {}", e.getMessage());
            }
        });
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    /**
     * 过滤 Git 错误消息中的凭据信息
     *
     * 防止敏感信息（如 personal access token）泄漏到日志或 API 响应中
     *
     * @param message 原始错误消息
     * @return 过滤后的错误消息
     */
    private String sanitizeGitCredentials(String message) {
        if (message == null || message.isEmpty()) {
            return message;
        }

        String sanitized = message;

        // 过滤 HTTPS URL 中的凭据: https://username:password@github.com
        sanitized = sanitized.replaceAll("https://[^@/]+@", "https://***@");

        // 过滤 SSH URL 中的凭据: ssh://user:pass@host
        sanitized = sanitized.replaceAll("ssh://[^@/]+@", "ssh://***@");

        // 过滤 GitHub Personal Access Token (ghp_, gho_, github_pat_)
        sanitized = sanitized.replaceAll("gh[po]_[A-Za-z0-9]{36,}", "***");
        sanitized = sanitized.replaceAll("github_pat_[A-Za-z0-9_]{82}", "***");

        // 过滤 GitLab Personal Access Token (glpat-)
        sanitized = sanitized.replaceAll("glpat-[A-Za-z0-9_-]{20,}", "***");

        return sanitized;
    }

    /**
     * 检查路径是否是 Git 仓库
     *
     * @param path 要检查的路径
     * @return true 如果是 Git 仓库；否则返回 false
     */
    public boolean isGitRepository(Path path) {
        return path.resolve(".git").toFile().exists();
    }

    /**
     * 获取当前 Git 分支名称
     *
     * @param repoPath Git 仓库路径
     * @return 当前分支名称
     * @throws BaseException 如果获取失败
     */
    public String getCurrentBranch(Path repoPath) throws BaseException {
        String output = executeCommand(repoPath, "git", "rev-parse", "--abbrev-ref", "HEAD");
        return output.trim();
    }

    /**
     * 切换到指定分支（如果分支不存在则创建）
     *
     * @param repoPath Git 仓库路径
     * @param branch 分支名称
     * @throws BaseException 如果切换失败
     */
    public void checkoutBranch(Path repoPath, String branch) throws BaseException {
        // 检查分支是否存在
        try {
            executeCommand(repoPath, "git", "rev-parse", "--verify", branch);
            // 分支存在，直接切换
            executeCommand(repoPath, "git", "checkout", branch);
            log.info("Switched to existing branch: {}", branch);
        } catch (BaseException e) {
            // 分支不存在，创建新分支
            // rev-parse 失败通常意味着分支不存在（exit code 128）
            if (e.getErrorCode() == 50500) {
                executeCommand(repoPath, "git", "checkout", "-b", branch);
                log.info("Created and switched to new branch: {}", branch);
            } else {
                // 其他错误直接抛出
                throw e;
            }
        }
    }

    /**
     * 添加 Git 子模块
     *
     * @param repoPath Git 仓库路径
     * @param url 子模块 URL
     * @param path 子模块路径
     * @param branch 子模块分支（可选）
     * @throws BaseException 如果添加失败
     */
    public void addSubmodule(Path repoPath, String url, String path, String branch) throws BaseException {
        List<String> command = new ArrayList<>();
        command.add("git");
        command.add("submodule");
        command.add("add");

        if (branch != null && !branch.isBlank()) {
            command.add("-b");
            command.add(branch);
        }

        command.add(url);
        command.add(path);

        executeSubmoduleCommand(repoPath, command.toArray(new String[0]));
        log.info("Added submodule: {} -> {}", url, path);
    }

    /**
     * 提交所有变更
     *
     * @param repoPath Git 仓库路径
     * @param message 提交消息
     * @param ghUser Git 用户名（可选，从 Redis 读取或使用默认值）
     * @param ghEmail Git 邮箱（可选，从 Redis 读取或使用默认值）
     * @return 提交哈希值
     * @throws BaseException 如果提交失败
     */
    public String commitAll(Path repoPath, String message, String ghUser, String ghEmail) throws BaseException {
        // 添加所有变更到暂存区
        executeCommand(repoPath, "git", "add", ".");

        // 检查是否有变更需要提交
        String status = executeCommand(repoPath, "git", "status", "--porcelain");
        if (status.trim().isEmpty()) {
            log.info("No changes to commit in {}", repoPath);
            // 返回当前 HEAD 的 commit hash
            String commitHash = executeCommand(repoPath, "git", "rev-parse", "HEAD");
            return commitHash.trim();
        }

        // 配置 Git 用户身份（仓库级别，避免全局污染）
        ensureGitUserConfig(repoPath, ghUser, ghEmail);

        // 提交变更
        executeCommand(repoPath, "git", "commit", "-m", message);
        log.info("Committed changes with message: {}", message);

        // 获取提交哈希
        String commitHash = executeCommand(repoPath, "git", "rev-parse", "HEAD");
        return commitHash.trim();
    }

    /**
     * 获取当前 commit hash
     *
     * @param repoPath Git 仓库路径
     * @return 当前 HEAD 的 commit hash
     * @throws BaseException 如果获取失败
     */
    public String getCurrentCommitHash(Path repoPath) throws BaseException {
        String commitHash = executeCommand(repoPath, "git", "rev-parse", "HEAD");
        return commitHash.trim();
    }

    /**
     * 确保 Git 用户配置存在（仓库级别）
     *
     * 在 Docker 容器等环境中，Git 可能没有配置全局用户信息。
     * 此方法从 Redis 用户私有参数或默认值读取用户信息并在仓库级别配置，仅影响当前仓库。
     *
     * Redis 私有参数（与 GH_TOKEN 同级）：
     * - GH_USER: Git 用户名（默认: "beyonai"）
     * - GH_EMAIL: Git 邮箱（默认: "haojingbyai@163.com"）
     *
     * @param repoPath Git 仓库路径
     * @param ghUser Git 用户名（可选，为 null 时使用默认值）
     * @param ghEmail Git 邮箱（可选，为 null 时使用默认值）
     * @throws BaseException 如果配置失败
     */
    private void ensureGitUserConfig(Path repoPath, String ghUser, String ghEmail) throws BaseException {
        try {
            // 检查是否已配置 user.name（仓库或全局）
            String userName = executeCommand(repoPath, "git", "config", "user.name").trim();
            String userEmail = executeCommand(repoPath, "git", "config", "user.email").trim();

            // 如果已配置，则跳过
            if (!userName.isEmpty() && !userEmail.isEmpty()) {
                log.debug("Git user config already exists: {} <{}>", userName, userEmail);
                return;
            }
        } catch (BaseException e) {
            // git config 不存在会返回 exit code 1，这里捕获后继续配置
            log.debug("Git user config not found, will configure it");
        }

        // 从参数读取用户信息（与 GH_TOKEN 从 Redis 读取一致）
        // 使用参数或默认值
        String userName = (ghUser != null && !ghUser.trim().isEmpty())
            ? ghUser.trim()
            : "beyonai";
        String userEmail = (ghEmail != null && !ghEmail.trim().isEmpty())
            ? ghEmail.trim()
            : "haojingbyai@163.com";

        // 配置仓库级别用户信息（不使用 --global）
        executeCommand(repoPath, "git", "config", "user.name", userName);
        executeCommand(repoPath, "git", "config", "user.email", userEmail);

        log.info("Configured Git user for repository: {} <{}> (from params: GH_USER={}, GH_EMAIL={})",
            userName, userEmail,
            ghUser != null ? "provided" : "default",
            ghEmail != null ? "provided" : "default");
    }

    /**
     * 推送到远程仓库
     *
     * @param repoPath Git 仓库路径
     * @param branch 分支名称
     * @throws BaseException 如果推送失败
     */
    public void push(Path repoPath, String branch) throws BaseException {
        executeCommand(repoPath, "git", "push", "-u", "origin", branch);
        log.info("Pushed branch {} to remote", branch);
    }

    /**
     * 克隆远程仓库到本地
     *
     * @param repoUrl 远程仓库 URL
     * @param targetPath 目标本地路径
     * @param branch 指定分支（可选，为空则克隆默认分支）
     * @throws BaseException 如果克隆失败
     */
    public void cloneRepository(String repoUrl, Path targetPath, String branch) throws BaseException {
        // 确保父目录存在
        Path parentDir = targetPath.getParent();
        if (parentDir != null && !parentDir.toFile().exists()) {
            boolean created = parentDir.toFile().mkdirs();
            if (!created) {
                throw new BaseException(50500,
                    "Failed to create parent directory: " + parentDir);
            }
            log.debug("Created parent directory: {}", parentDir);
        }

        // 构建 git clone 命令
        List<String> command = new ArrayList<>();
        command.add("git");
        command.add("clone");

        if (branch != null && !branch.isBlank()) {
            command.add("-b");
            command.add(branch);
        }

        command.add(repoUrl);
        command.add(targetPath.toString());

        // 使用动态配置的克隆超时时间（从 Redis 读取，默认 15 分钟）
        long cloneTimeout = getCloneTimeout();

        log.info("Cloning repository from {} to {} (branch: {})",
            repoUrl, targetPath, branch != null ? branch : "default");

        try {
            ProcessBuilder processBuilder = new ProcessBuilder(command);
            processBuilder.redirectErrorStream(false);

            Process process = processBuilder.start();

            // 异步读取 stdout 和 stderr
            StringBuilder stdout = new StringBuilder();
            StringBuilder stderr = new StringBuilder();

            Thread stdoutReader = startOutputReader(process.getInputStream(), stdout, true);
            Thread stderrReader = startOutputReader(process.getErrorStream(), stderr, true);

            // 等待克隆完成
            boolean completed = process.waitFor(cloneTimeout, TimeUnit.SECONDS);

            if (!completed) {
                process.destroyForcibly();
                throw new BaseException(50500,
                    String.format("Git clone timeout after %d seconds. Repository: %s",
                        cloneTimeout, repoUrl));
            }

            // 等待输出读取完成
            stdoutReader.join(5000);
            stderrReader.join(5000);

            int exitCode = process.exitValue();

            if (exitCode != 0) {
                String sanitizedStderr = sanitizeGitCredentials(stderr.toString());
                throw new BaseException(50500,
                    String.format("Git clone failed with exit code %d. Repository: %s\nError: %s",
                        exitCode, repoUrl, sanitizedStderr));
            }

            log.info("Successfully cloned repository to {}", targetPath);

        } catch (IOException e) {
            throw new BaseException(50500,
                "Failed to execute git clone command: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BaseException(50500,
                "Git clone interrupted: " + repoUrl, e);
        }
    }
}
