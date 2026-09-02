package com.iwhalecloud.byai.manager.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.application.service.session.ByClawUserWorkspacePaths;
import org.apache.commons.lang3.StringUtils;

/**
 * Git 工作空间配置类
 *
 * 用于配置集成项目 Git 仓库的根目录路径
 * 根目录 = file.storage.local.path + "/byclaw-{userCode}/projects/{projectId}/repos"
 */
@Component
public class GitWorkspaceConfig {

    /**
     * 文件存储根路径（从 Spring 容器注入）
     */
    @Value("${file.storage.local.path}")
    private String fileStorageLocalPath;

    /**
     * 获取指定项目的 Git 工作空间根目录，不存在时自动创建。
     *
     * @param projectId 项目 ID
     * @param userBucketName 项目创建者的用户桶名称
     * @return 项目下的 Git 仓库根目录路径
     */
    public String getRoot(Long projectId, String userBucketName) {
        String userFsRoot = StringUtils.stripStart(ByClawUserWorkspacePaths.USER_FS_OBJECT_KEY_ROOT_PREFIX, "/");
        Path projectRepos = Paths.get(fileStorageLocalPath, userBucketName, userFsRoot, "projects",
            String.valueOf(projectId), "repos");
        try {
            Files.createDirectories(projectRepos);
            return projectRepos.toString();
        }
        catch (IOException e) {
            throw new IllegalStateException("Failed to create git workspace root: " + projectRepos, e);
        }
    }
}
