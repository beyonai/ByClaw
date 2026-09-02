package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/** 从 workspace 仓库的 .gitmodules 定位目标 code 仓库的实际本地目录。 */
@Service
public class GitSubmodulePathResolver {

    public Optional<Path> resolve(Path workspaceDir, ProjectRepo codeRepo) {
        if (workspaceDir == null || codeRepo == null) {
            return Optional.empty();
        }
        Path gitmodules = workspaceDir.resolve(".gitmodules");
        if (!Files.isRegularFile(gitmodules)) {
            return Optional.empty();
        }
        try {
            List<SubmoduleEntry> entries = parse(Files.readAllLines(gitmodules));
            String expectedUrl = normalizeUrl(codeRepo.getRepoUrl());
            String expectedName = normalizeRepoName(codeRepo.getRepoFullName());
            for (SubmoduleEntry entry : entries) {
                if ((expectedUrl != null && expectedUrl.equals(normalizeUrl(entry.url)))
                    || (expectedName != null && expectedName.equals(normalizeRepoName(entry.url)))) {
                    Path path = workspaceDir.resolve(entry.path).normalize();
                    if (path.startsWith(workspaceDir.normalize())) {
                        return Optional.of(path);
                    }
                }
            }
        }
        catch (IOException ignored) {
            // 查询接口会在上层回退到远程 compare，解析失败不应阻断任务详情页面。
        }
        return Optional.empty();
    }

    /**
     * 按 .gitmodules 中的实际顺序返回已配置代码仓库对应的子模块目录。
     * 数据库中存在但 .gitmodules 未声明的仓库不会被当作当前 workspace 的子模块。
     */
    public List<ResolvedSubmodule> resolveAll(Path workspaceDir, List<ProjectRepo> codeRepos) {
        return resolveAllWithStatus(workspaceDir, codeRepos).submodules();
    }

    /** 返回子模块解析结果及元数据是否成功读取，供上层区分“没有子模块”和“.gitmodules 不可用”。 */
    public SubmoduleResolution resolveAllWithStatus(Path workspaceDir, List<ProjectRepo> codeRepos) {
        if (workspaceDir == null || codeRepos == null || codeRepos.isEmpty()) {
            return new SubmoduleResolution(List.of(), workspaceDir != null);
        }
        Path gitmodules = workspaceDir.resolve(".gitmodules");
        if (!Files.isRegularFile(gitmodules)) {
            return new SubmoduleResolution(List.of(), false);
        }
        try {
            List<ResolvedSubmodule> resolved = new ArrayList<>();
            for (SubmoduleEntry entry : parse(Files.readAllLines(gitmodules))) {
                ProjectRepo repo = findMatchingRepo(entry, codeRepos);
                if (repo == null) {
                    continue;
                }
                Path path = workspaceDir.resolve(entry.path).normalize();
                if (path.startsWith(workspaceDir.normalize())) {
                    resolved.add(new ResolvedSubmodule(repo, path));
                }
            }
            return new SubmoduleResolution(resolved, true);
        }
        catch (IOException ignored) {
            return new SubmoduleResolution(List.of(), false);
        }
    }

    private ProjectRepo findMatchingRepo(SubmoduleEntry entry, List<ProjectRepo> codeRepos) {
        String entryUrl = normalizeUrl(entry.url);
        String entryName = normalizeRepoName(entry.url);
        for (ProjectRepo repo : codeRepos) {
            String repoUrl = normalizeUrl(repo.getRepoUrl());
            String repoName = normalizeRepoName(repo.getRepoFullName());
            if ((repoUrl != null && repoUrl.equals(entryUrl)) || (repoName != null && repoName.equals(entryName))) {
                return repo;
            }
        }
        return null;
    }

    private List<SubmoduleEntry> parse(List<String> lines) {
        List<SubmoduleEntry> entries = new ArrayList<>();
        String path = null;
        String url = null;
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.startsWith("[submodule ")) {
                if (StringUtils.isNotBlank(path) && StringUtils.isNotBlank(url)) {
                    entries.add(new SubmoduleEntry(path, url));
                }
                path = null;
                url = null;
            }
            else if (trimmed.startsWith("path")) {
                path = valueOf(trimmed);
            }
            else if (trimmed.startsWith("url")) {
                url = valueOf(trimmed);
            }
        }
        if (StringUtils.isNotBlank(path) && StringUtils.isNotBlank(url)) {
            entries.add(new SubmoduleEntry(path, url));
        }
        return entries;
    }

    private String valueOf(String line) {
        int equals = line.indexOf('=');
        return equals < 0 ? null : line.substring(equals + 1).trim();
    }

    static String normalizeUrl(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        String url = value.trim();
        if (url.startsWith("git@") && url.contains(":")) {
            url = "ssh://" + url.substring(4).replaceFirst(":", "/");
        }
        try {
            URI uri = URI.create(url);
            String host = uri.getHost();
            String path = uri.getPath();
            if (host != null && path != null) {
                url = host + path;
            }
        }
        catch (IllegalArgumentException ignored) {
            // 保留原始值继续做基本规范化。
        }
        url = url.toLowerCase(Locale.ROOT);
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url.endsWith(".git") ? url.substring(0, url.length() - 4) : url;
    }

    private String normalizeRepoName(String value) {
        String normalized = normalizeUrl(value);
        if (normalized == null) {
            return null;
        }
        int slash = normalized.lastIndexOf('/');
        return slash < 0 ? normalized : normalized.substring(Math.max(0, normalized.lastIndexOf('/', slash - 1) + 1));
    }

    private record SubmoduleEntry(String path, String url) {
    }

    public record ResolvedSubmodule(ProjectRepo repo, Path path) {
    }

    public record SubmoduleResolution(List<ResolvedSubmodule> submodules, boolean metadataAvailable) {
    }
}
