package com.iwhalecloud.byai.manager.domain.project.service;

import com.iwhalecloud.byai.common.exception.BaseException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
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
     * 执行 Git 命令（使用默认超时）
     *
     * @param repoPath Git 仓库路径
     * @param command Git 命令及参数
     * @return 命令的标准输出
     * @throws BaseException 如果命令执行失败或超时
     */
    public String executeCommand(Path repoPath, String... command) throws BaseException {
        return executeCommand(repoPath, DEFAULT_TIMEOUT_SECONDS, command);
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

            Thread stdoutReader = startOutputReader(process.getInputStream(), stdout);
            Thread stderrReader = startOutputReader(process.getErrorStream(), stderr);

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
        return executeCommand(repoPath, SUBMODULE_TIMEOUT_SECONDS, command);
    }

    /**
     * 启动一个线程异步读取进程输出流
     *
     * 防止输出缓冲区满导致进程阻塞
     */
    private Thread startOutputReader(java.io.InputStream inputStream, StringBuilder output) {
        Thread thread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                }
            } catch (IOException e) {
                log.warn("Error reading process output: {}", e.getMessage());
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
     * @return 提交哈希值
     * @throws BaseException 如果提交失败
     */
    public String commitAll(Path repoPath, String message) throws BaseException {
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

        // 使用更长的超时时间（15分钟），因为克隆可能需要下载大量数据
        long cloneTimeout = 900; // 15 minutes

        log.info("Cloning repository from {} to {} (branch: {})",
            repoUrl, targetPath, branch != null ? branch : "default");

        try {
            ProcessBuilder processBuilder = new ProcessBuilder(command);
            processBuilder.redirectErrorStream(false);

            Process process = processBuilder.start();

            // 异步读取 stdout 和 stderr
            StringBuilder stdout = new StringBuilder();
            StringBuilder stderr = new StringBuilder();

            Thread stdoutReader = startOutputReader(process.getInputStream(), stdout);
            Thread stderrReader = startOutputReader(process.getErrorStream(), stderr);

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
