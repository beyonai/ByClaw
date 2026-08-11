package com.iwhalecloud.byai.manager.config;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import lombok.extern.slf4j.Slf4j;

/**
 * Git 工作空间配置类
 *
 * 用于配置集成项目 Git 仓库的根目录路径
 * 根目录 = file.storage.local.path + "/repos"
 */
@Slf4j
@Component
public class GitWorkspaceConfig {

    /**
     * 文件存储根路径（从 Spring 容器注入）
     */
    @Value("${file.storage.local.path}")
    private String fileStorageLocalPath;

    /**
     * Git 工作空间根目录
     */
    private String root;

    /**
     * 获取 Git 工作空间根目录
     *
     * @return Git 仓库根目录路径
     */
    public String getRoot() {
        if (root == null) {
            root = Paths.get(fileStorageLocalPath, "repos").toString();
        }
        return root;
    }

    /**
     * 验证配置有效性
     *
     * 在 Spring Bean 初始化后执行，确保配置的根目录存在且可访问
     */
    //@PostConstruct
    public void validate() {
        // 初始化 root
        getRoot();

        if (root == null || root.isBlank()) {
            throw new IllegalStateException("file.storage.local.path must be configured in application.properties");
        }

        Path rootPath = Paths.get(root);

        // 如果目录不存在，尝试创建
        if (!Files.exists(rootPath)) {
            try {
                Files.createDirectories(rootPath);
                log.info("Created git workspace root directory: {}", root);
            } catch (Exception e) {
                throw new IllegalStateException(
                    "Failed to create git.workspace.root: " + root +
                    ". Please create this directory manually or check permissions.", e
                );
            }
        }

        if (!Files.isDirectory(rootPath)) {
            throw new IllegalStateException(
                "git.workspace.root is not a directory: " + root
            );
        }

        if (!Files.isReadable(rootPath) || !Files.isWritable(rootPath)) {
            throw new IllegalStateException(
                "git.workspace.root is not readable or writable: " + root +
                ". Please check directory permissions."
            );
        }

        log.info("Git workspace root configured and validated: {} (derived from file.storage.local.path: {})",
            root, fileStorageLocalPath);
    }
}
