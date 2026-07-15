package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.util.OkHttpUtil;
import com.iwhalecloud.byai.manager.entity.devloop.ScanLogItem;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import lombok.extern.slf4j.Slf4j;
import okhttp3.Headers;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * GitHub Issue 扫描服务
 * 通过 GitHub REST API 拉取指定仓库的 Issue 列表，去重后写入扫描日志
 */
@Slf4j
@Service
public class GitHubIssueScanService {

    private static final String GITHUB_API_BASE = "https://api.github.com";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired
    private ScanLogService scanLogService;

    @Autowired
    private ScanSourceService scanSourceService;

    /** 执行一次 Issue 扫描，返回本次新增的条目列表 */
    public List<ScanLogItem> scan(ScanSource source, String pat) {
        List<ScanLogItem> items = new ArrayList<>();
        Long logId = null;

        try {
            JsonNode configNode = MAPPER.readTree(source.getConfig());
            String repo = configNode.path("repo").asText();
            String labels = configNode.path("labels").asText("");
            String state = configNode.path("state").asText("open");

            var scanLog = scanLogService.createLog(
                source.getSourceId(), source.getProjectId());
            logId = scanLog.getLogId();

            String url = GITHUB_API_BASE + "/repos/" + repo + "/issues"
                + "?state=" + state
                + "&sort=updated&direction=desc&per_page=30";
            if (!labels.isEmpty()) {
                url += "&labels=" + labels;
            }

            Headers headers = new Headers.Builder()
                .add("Authorization", "Bearer " + pat)
                .add("Accept", "application/vnd.github+json")
                .add("X-GitHub-Api-Version", "2022-11-28")
                .build();

            Response response = OkHttpUtil.getRequest(url, headers);
            if (response == null || !response.isSuccessful()) {
                String errMsg = response != null
                    ? "HTTP " + response.code() : "No response";
                scanLogService.failLog(logId, errMsg);
                return items;
            }

            String body = response.body().string();
            JsonNode issuesNode = MAPPER.readTree(body);

            int foundCount = 0;
            int createdCount = 0;

            for (JsonNode issue : issuesNode) {
                if (issue.has("pull_request")) {
                    continue;
                }
                foundCount++;
                String issueNumber = issue.path("number").asText();
                String title = issue.path("title").asText();
                String content = issue.path("body").asText("");
                String htmlUrl = issue.path("html_url").asText();

                if (scanLogService.isDuplicate(source.getSourceId(), issueNumber)) {
                    scanLogService.createItem(logId, source.getSourceId(),
                        title, content, issueNumber, htmlUrl, "duplicate");
                } else {
                    ScanLogItem item = scanLogService.createItem(logId,
                        source.getSourceId(), title, content,
                        issueNumber, htmlUrl, "created");
                    items.add(item);
                    createdCount++;
                }
            }

            scanLogService.completeLog(logId, foundCount, createdCount);
            scanSourceService.updateLastScanTime(source.getSourceId());

        } catch (Exception e) {
            log.error("GitHub issue scan failed for source: {}",
                source.getSourceId(), e);
            if (logId != null) {
                scanLogService.failLog(logId, e.getMessage());
            }
        }
        return items;
    }
}
