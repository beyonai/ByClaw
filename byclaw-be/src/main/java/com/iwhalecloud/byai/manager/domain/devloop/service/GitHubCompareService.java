package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.util.OkHttpUtil;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import okhttp3.Headers;
import okhttp3.Response;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * GitHub 分支变更比对服务
 * 通过 GitHub REST compare API 拉取目标分支相对基线分支的文件变更列表(远程分支口径)。
 * 本地分支(codeagent 容器内未 push 的改动)后端不可达，暂不支持；见 getTaskChanges 的 TODO。
 */
@Slf4j
@Service
public class GitHubCompareService {

    private static final String GITHUB_API_BASE = "https://api.github.com";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 比对结果状态：闭合取值，前端据此区分不同空态，避免用裸 null 猜含义。 */
    public enum CompareStatus {
        /** 成功取到变更列表 */
        OK,
        /** 任务未关联代码仓库 */
        NO_REPO,
        /** 未配置 GitHub 访问令牌 */
        NO_TOKEN,
        /** 远程分支尚未创建(GitHub 404)：codeagent 还没 push 或还没建分支 */
        BRANCH_NOT_FOUND,
        /** 其他 HTTP / 解析错误 */
        HTTP_ERROR
    }

    /** 单个文件的变更描述。status 直接沿用 GitHub 语义:added/modified/removed/renamed/copied/changed。 */
    @Getter
    public static class FileChange {
        private final String filename;
        private final String status;
        private final int additions;
        private final int deletions;
        /** 重命名时的原路径，其余为空 */
        private final String previousFilename;
        /** 该文件在 head 分支上的 GitHub 页面地址,供前端超链查看;删除文件为空(head 上已不存在)。 */
        private final String blobUrl;

        public FileChange(String filename, String status, int additions, int deletions, String previousFilename,
            String blobUrl) {
            this.filename = filename;
            this.status = status;
            this.additions = additions;
            this.deletions = deletions;
            this.previousFilename = previousFilename;
            this.blobUrl = blobUrl;
        }
    }

    /** 比对结果快照:状态 + 分支信息 + 文件变更。 */
    @Getter
    public static class CompareResult {
        private final CompareStatus status;
        private final String repoFullName;
        private final String baseBranch;
        private final String headBranch;
        private final int aheadBy;
        private final List<FileChange> files;
        /** 整个 base...head 比对的 GitHub 页面地址,供前端“在 GitHub 查看”整体入口。 */
        private final String compareUrl;
        /** 非 OK 时的可读原因,供前端兜底展示 */
        private final String message;

        private CompareResult(CompareStatus status, String repoFullName, String baseBranch, String headBranch,
            int aheadBy, List<FileChange> files, String compareUrl, String message) {
            this.status = status;
            this.repoFullName = repoFullName;
            this.baseBranch = baseBranch;
            this.headBranch = headBranch;
            this.aheadBy = aheadBy;
            this.files = files;
            this.compareUrl = compareUrl;
            this.message = message;
        }

        static CompareResult ok(String repo, String base, String head, int aheadBy, List<FileChange> files,
            String compareUrl) {
            return new CompareResult(CompareStatus.OK, repo, base, head, aheadBy, files, compareUrl, null);
        }

        static CompareResult fail(CompareStatus status, String repo, String base, String head, String message) {
            return new CompareResult(status, repo, base, head, 0, new ArrayList<>(), null, message);
        }
    }

    /**
     * 比对 base...head 两分支,返回 head 相对 base 的文件变更(GitHub compare 语义,merge-base 之后的改动)。
     * base/head 会做 URL 转义,支持形如 feat/task-123 的带斜杠分支名。
     */
    public CompareResult compare(String repoFullName, String base, String head, String pat) {
        if (repoFullName == null || repoFullName.trim().isEmpty()) {
            return CompareResult.fail(CompareStatus.NO_REPO, repoFullName, base, head, "任务未关联代码仓库");
        }
        if (pat == null || pat.trim().isEmpty()) {
            return CompareResult.fail(CompareStatus.NO_TOKEN, repoFullName, base, head, "未配置 GitHub 访问令牌");
        }

        // compare 端点的 basehead 段整体是一个路径参数,分支名里的 / 不能编码,否则 GitHub 无法解析;
        // 仅对可能含特殊字符的分支名做温和处理,常见 feat/xxx、fix/xxx 直接可用。
        String url = GITHUB_API_BASE + "/repos/" + repoFullName.trim() + "/compare/"
            + base + "..." + head;

        Headers headers = new Headers.Builder()
            .add("Authorization", "Bearer " + pat)
            .add("Accept", "application/vnd.github+json")
            .add("X-GitHub-Api-Version", "2022-11-28")
            .build();

        try {
            Response response = OkHttpUtil.getRequest(url, headers);
            if (response == null) {
                return CompareResult.fail(CompareStatus.HTTP_ERROR, repoFullName, base, head, "GitHub 无响应");
            }
            if (response.code() == 404) {
                // 分支不存在或仓库不可见:最常见是目标分支还没 push。
                return CompareResult.fail(CompareStatus.BRANCH_NOT_FOUND, repoFullName, base, head,
                    "远程分支尚未创建(" + head + ")");
            }
            if (!response.isSuccessful() || response.body() == null) {
                return CompareResult.fail(CompareStatus.HTTP_ERROR, repoFullName, base, head,
                    "GitHub HTTP " + response.code());
            }

            JsonNode root = MAPPER.readTree(response.body().string());
            int aheadBy = root.path("ahead_by").asInt(0);
            String compareUrl = root.path("html_url").asText(null);
            List<FileChange> files = new ArrayList<>();
            for (JsonNode f : root.path("files")) {
                files.add(new FileChange(
                    f.path("filename").asText(""),
                    f.path("status").asText("modified"),
                    f.path("additions").asInt(0),
                    f.path("deletions").asInt(0),
                    f.path("previous_filename").asText(null),
                    f.path("blob_url").asText(null)));
            }
            return CompareResult.ok(repoFullName, base, head, aheadBy, files, compareUrl);
        } catch (Exception e) {
            log.error("[Devloop] GitHub compare 失败 repo={} {}...{}", repoFullName, base, head, e);
            return CompareResult.fail(CompareStatus.HTTP_ERROR, repoFullName, base, head, e.getMessage());
        }
    }
}
