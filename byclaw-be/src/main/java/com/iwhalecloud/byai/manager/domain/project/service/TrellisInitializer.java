package com.iwhalecloud.byai.manager.domain.project.service;

import com.iwhalecloud.byai.common.exception.BaseException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Path;

/**
 * Trellis 技能包初始化器
 *
 * 通过执行 `trellis init` 命令初始化 Trellis 项目结构
 */
@Slf4j
@Component
public class TrellisInitializer {

    /**
     * 初始化 Trellis 技能包
     *
     * 执行 `trellis init` 命令（非交互式），创建以下结构：
     * - .trellis/
     * - .trellis/workflow.md
     * - .trellis/config.yaml
     * - .trellis/tasks/
     * - .trellis/workspace/
     * - .trellis/spec/
     *
     * 命令参数：
     * - --claude: 配置 Claude Code
     * - --monorepo: 启用 monorepo 模式
     * - -y: 跳过交互提示，使用默认值
     * - -f: 覆盖现有文件
     *
     * @param repoPath Git 仓库路径
     * @throws BaseException 如果初始化失败
     */
    public void initialize(Path repoPath) throws BaseException {
        log.info("Initializing Trellis skill package in: {}", repoPath);

        // 检查 trellis 命令是否可用
        if (!isTrellisInstalled()) {
            throw new BaseException(50500,
                "Trellis CLI is not installed or not in PATH. " +
                "Please install it first: https://github.com/trellis-ai/trellis");
        }

        // 执行 trellis init 命令（非交互式）
        // --claude: 配置 Claude Code
        // --monorepo: 启用 monorepo 模式
        // -y: 跳过提示使用默认值
        // -f: 覆盖现有文件
        try {
            ProcessBuilder processBuilder = new ProcessBuilder(
                "trellis", "init",
                "--claude",           // 配置 Claude Code
                "--monorepo",         // 启用 monorepo 模式
                "-y",                 // 跳过提示
                "-f"                  // 覆盖现有文件
            );
            processBuilder.directory(repoPath.toFile());
            processBuilder.redirectErrorStream(true);

            Process process = processBuilder.start();

            // 读取输出
            StringBuilder output = new StringBuilder();
            try (var reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                    log.debug("Trellis init: {}", line);
                }
            }

            int exitCode = process.waitFor();

            if (exitCode != 0) {
                throw new BaseException(50500,
                    String.format("Trellis init failed with exit code %d: %s",
                        exitCode, output.toString()));
            }

            log.info("Trellis skill package initialized successfully");

        } catch (IOException e) {
            throw new BaseException(50500,
                "Failed to execute trellis init: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BaseException(50500,
                "Trellis init was interrupted", e);
        }

        // 验证初始化结果
        if (!repoPath.resolve(".trellis").toFile().exists()) {
            throw new BaseException(50500,
                "Trellis initialization completed but .trellis directory was not created");
        }
    }

    /**
     * 检查 Trellis CLI 是否已安装
     *
     * @return true 如果 trellis 命令可用；否则返回 false
     */
    private boolean isTrellisInstalled() {
        try {
            ProcessBuilder processBuilder = new ProcessBuilder("trellis", "--version");
            Process process = processBuilder.start();
            int exitCode = process.waitFor();
            return exitCode == 0;
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }
}
