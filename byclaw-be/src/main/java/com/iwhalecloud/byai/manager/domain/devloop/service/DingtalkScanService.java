package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.entity.devloop.ScanLogItem;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 钉钉群消息扫描服务
 * 通过 DWS CLI 按关键词搜索指定群的消息，去重后写入扫描日志
 */
@Slf4j
@Service
public class DingtalkScanService {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final DateTimeFormatter ISO_FMT =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'+08:00'");

    private static final String DWS_BIN = "dws";

    @Autowired
    private ScanLogService scanLogService;

    @Autowired
    private ScanSourceService scanSourceService;

    @Autowired
    private DwsAuthService dwsAuthService;

    /** 执行一次钉钉消息扫描，返回本次新增的条目列表；授权失败返回 null */
    public List<ScanLogItem> scan(ScanSource source) {
        List<ScanLogItem> items = new ArrayList<>();
        Long logId = null;

        try {
            // 确保 dws 已认证
            if (!dwsAuthService.ensureAuthenticated(source.getCreateBy())) {
                log.error("[DingtalkScan] DWS未授权，无法扫描。sourceId={}", source.getSourceId());
                return null;
            }

            JsonNode configNode = MAPPER.readTree(source.getConfig());
            String groupId = configNode.path("groupId").asText();
            String keyword = configNode.path("keyword").asText();
            String corpId = configNode.path("corpId").asText("");
            int lookbackHours = configNode.path("lookbackHours").asInt(24);

            log.info("[DingtalkScan] sourceId={}, groupId={}, keyword={}, corpId={}, lookbackHours={}",
                source.getSourceId(), groupId, keyword, corpId, lookbackHours);

            var scanLog = scanLogService.createLog(
                source.getSourceId(), source.getProjectId());
            logId = scanLog.getLogId();

            LocalDateTime now = LocalDateTime.now();
            LocalDateTime start = source.getLastScanTime() != null
                ? new java.sql.Timestamp(source.getLastScanTime().getTime())
                    .toLocalDateTime()
                : now.minusHours(lookbackHours);

            String startStr = start.format(ISO_FMT);

            // 使用 list 命令直接拉取群消息（search 有 SearchRightsDenied 限制且索引不全）
            List<String> cmd = new ArrayList<>();
            cmd.add(DWS_BIN);
            cmd.add("chat");
            cmd.add("message");
            cmd.add("list");
            cmd.add("--group");
            cmd.add(groupId);
            cmd.add("--time");
            cmd.add(startStr.replace("T", " ").replace("+08:00", ""));
            cmd.add("--direction");
            cmd.add("newer");
            cmd.add("--limit");
            cmd.add("50");
            cmd.add("--format");
            cmd.add("json");
            if (!corpId.isEmpty()) {
                cmd.add("--profile");
                cmd.add(corpId);
            }

            log.info("[DingtalkScan] executing: {}", String.join(" ", cmd));

            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            // 确保 dws 能找到 HOME 下的配置和 keyring
            Map<String, String> env = pb.environment();
            if (!env.containsKey("HOME")) {
                env.put("HOME", System.getProperty("user.home"));
            }
            Process process = pb.start();

            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line);
                }
            }

            boolean finished = process.waitFor(60, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                log.error("[DingtalkScan] command timeout");
                scanLogService.failLog(logId, "DWS command timeout");
                return items;
            }

            log.info("[DingtalkScan] exitCode={}, output={}",
                process.exitValue(), output.toString());

            if (process.exitValue() != 0) {
                String errDetail = output.toString();
                log.error("[DingtalkScan] DWS command failed: exitCode={}, output={}", process.exitValue(), errDetail);
                scanLogService.failLog(logId,
                    "DWS exit code: " + process.exitValue() + ", output: " + (errDetail.length() > 500 ? errDetail.substring(0, 500) : errDetail));
                return null;
            }

            JsonNode root = MAPPER.readTree(output.toString());
            JsonNode messages = root.path("result").path("messages");
            if (!messages.isArray() || messages.isEmpty()) {
                log.warn("[DingtalkScan] no messages found in response");
                scanLogService.completeLog(logId, 0, 0);
                scanSourceService.updateLastScanTime(source.getSourceId());
                return items;
            }

            int foundCount = 0;
            int createdCount = 0;

            for (JsonNode msg : messages) {
                String content = msg.path("content").asText("");
                // 代码层关键词过滤（list 不支持 keyword 参数）
                if (!keyword.isEmpty() && !content.contains(keyword)) {
                    continue;
                }

                foundCount++;
                String msgId = msg.path("openMessageId").asText("");
                String senderName = msg.path("sender").asText("");

                String displayTitle = "[" + senderName + "] " + content;
                if (displayTitle.length() > 150) {
                    displayTitle = displayTitle.substring(0, 150) + "...";
                }

                log.debug("[DingtalkScan] msg: id={}, sender={}, content={}",
                    msgId, senderName, content.length() > 50 ? content.substring(0, 50) : content);

                // 重复项直接跳过不落库：去重只认 created 行，定时任务每分钟扫描若为重复项写行会撑爆表。
                if (scanLogService.isDuplicate(source.getSourceId(), msgId)) {
                    continue;
                }
                ScanLogItem item = scanLogService.createItem(logId,
                    source.getSourceId(), displayTitle,
                    content, msgId, null, "created");
                items.add(item);
                createdCount++;
            }

            log.info("[DingtalkScan] done: found={}, created={}", foundCount, createdCount);
            scanLogService.completeLog(logId, foundCount, createdCount);
            if (foundCount > 0) {
                scanSourceService.updateLastScanTime(source.getSourceId());
            }

        } catch (Exception e) {
            log.error("[DingtalkScan] failed for source: {}",
                source.getSourceId(), e);
            if (logId != null) {
                scanLogService.failLog(logId, e.getMessage());
            }
        }
        return items;
    }
}
