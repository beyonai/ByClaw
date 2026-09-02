package com.iwhalecloud.byai.manager.domain.project.service;

import com.iwhalecloud.byai.common.exception.BaseException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

/**
 * Superpower 技能包初始化器
 *
 * 创建 Superpower 技能包所需的目录和文件结构
 */
@Slf4j
@Component
public class SuperpowerInitializer {

    /**
     * .agents/skills/README.md 文件模板
     */
    private static final String README_TEMPLATE = """
        # Skills Directory

        This directory contains custom skills for the Superpower agent framework.

        ## Structure

        Each skill should be placed in its own subdirectory:

        ```
        .agents/skills/
        ├── skill-name-1/
        │   ├── skill.md       # Skill definition
        │   └── examples/      # Optional examples
        └── skill-name-2/
            └── skill.md
        ```

        ## Creating a New Skill

        1. Create a new directory under `.agents/skills/`
        2. Add a `skill.md` file with your skill definition
        3. Follow the Superpower skill format guidelines

        For more information, visit: https://github.com/superpowers-ai/superpowers
        """;

    /**
     * .claude/settings.json 文件模板
     */
    private static final String SETTINGS_JSON_TEMPLATE = """
        {
          "permissions": {
            "allow": [
              "read:**/*",
              "bash:git status",
              "bash:git diff",
              "bash:git log"
            ]
          },
          "context": {
            "alwaysInclude": [
              ".agents/**/*.md",
              "CLAUDE.md"
            ]
          }
        }
        """;

    /**
     * 初始化 Superpower 技能包
     *
     * 创建以下结构：
     * - .agents/skills/README.md
     * - .agents/skills/.gitkeep
     * - .claude/settings.json
     *
     * @param repoPath Git 仓库路径
     * @throws BaseException 如果初始化失败
     */
    public void initialize(Path repoPath) throws BaseException {
        log.info("Initializing Superpower skill package in: {}", repoPath);

        try {
            // 创建 .agents/skills/ 目录
            Path agentsSkillsDir = repoPath.resolve(".agents/skills");
            Files.createDirectories(agentsSkillsDir);
            log.debug("Created directory: {}", agentsSkillsDir);

            // 创建 README.md
            Path readmePath = agentsSkillsDir.resolve("README.md");
            Files.writeString(readmePath, README_TEMPLATE,
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            log.debug("Created file: {}", readmePath);

            // 创建 .gitkeep（确保空目录被 Git 跟踪）
            Path gitkeepPath = agentsSkillsDir.resolve(".gitkeep");
            if (!Files.exists(gitkeepPath)) {
                Files.createFile(gitkeepPath);
                log.debug("Created file: {}", gitkeepPath);
            }

            // 创建 .claude/ 目录
            Path claudeDir = repoPath.resolve(".claude");
            Files.createDirectories(claudeDir);
            log.debug("Created directory: {}", claudeDir);

            // 创建 settings.json
            Path settingsPath = claudeDir.resolve("settings.json");
            Files.writeString(settingsPath, SETTINGS_JSON_TEMPLATE,
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            log.debug("Created file: {}", settingsPath);

            log.info("Superpower skill package initialized successfully");

        } catch (IOException e) {
            throw new BaseException(50500,
                "Failed to create Superpower skill package files: " + e.getMessage(), e);
        }

        // 验证初始化结果
        if (!repoPath.resolve(".agents/skills").toFile().exists()) {
            throw new BaseException(50500,
                "Superpower initialization completed but .agents/skills directory was not created");
        }

        if (!repoPath.resolve(".claude/settings.json").toFile().exists()) {
            throw new BaseException(50500,
                "Superpower initialization completed but .claude/settings.json was not created");
        }
    }
}
