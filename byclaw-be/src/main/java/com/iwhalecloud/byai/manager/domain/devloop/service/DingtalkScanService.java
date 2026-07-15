package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.entity.devloop.ScanLogItem;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
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

    @Value("${devloop.dws.bin:dws}")
    private String dwsBin;

    @Autowired
    private ScanLogService scanLogService;

    @Autowired
    private ScanSourceService scanSourceService;

    /** 执行一次钉钉消息扫描，返回本次新增的条目列表 */
    public List<ScanLogItem> scan(ScanSource source) {
        List<ScanLogItem> items = new ArrayList<>();
        Long logId = null;

        try {
            JsonNode configNode = MAPPER.readTree(source.getConfig());
            String groupId = configNode.path("groupId").asText();
            String keyword = configNode.path("keyword").asText();
            int lookbackHours = configNode.path("lookbackHours").asInt(24);

            log.info("[DingtalkScan] sourceId={}, groupId={}, keyword={}, lookbackHours={}",
                source.getSourceId(), groupId, keyword, lookbackHours);

            var scanLog = scanLogService.createLog(
                source.getSourceId(), source.getProjectId());
            logId = scanLog.getLogId();

            LocalDateTime end = LocalDateTime.now();
            LocalDateTime start = source.getLastScanTime() != null
                ? new java.sql.Timestamp(source.getLastScanTime().getTime())
                    .toLocalDateTime()
                : end.minusHours(lookbackHours);

            String startStr = start.format(ISO_FMT);
            String endStr = end.format(ISO_FMT);

            List<String> cmd = new ArrayList<>();
            cmd.add(dwsBin);
            cmd.add("chat");
            cmd.add("message");
            cmd.add("search");
            cmd.add("--keyword");
            cmd.add(keyword);
            cmd.add("--group");
            cmd.add(groupId);
            cmd.add("--start");
            cmd.add(startStr);
            cmd.add("--end");
            cmd.add(endStr);
            cmd.add("--limit");
            cmd.add("50");
            cmd.add("--format");
            cmd.add("json");

            log.info("[DingtalkScan] executing: {}", String.join(" ", cmd));

            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
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
                scanLogService.failLog(logId,
                    "DWS exit code: " + process.exitValue());
                return items;
            }

            JsonNode root = MAPPER.readTree(output.toString());
            JsonNode convList = root.path("result").path("conversationMessagesList");
            if (!convList.isArray() || convList.isEmpty()) {
                log.warn("[DingtalkScan] no conversationMessagesList found in response");
                scanLogService.completeLog(logId, 0, 0);
                scanSourceService.updateLastScanTime(source.getSourceId());
                return items;
            }

            int foundCount = 0;
            int createdCount = 0;

            for (JsonNode conv : convList) {
                JsonNode messages = conv.path("messages");
                if (!messages.isArray()) continue;

                for (JsonNode msg : messages) {
                    foundCount++;
                    String msgId = msg.path("openMessageId").asText("");
                    String content = msg.path("content").asText("");
                    String senderName = msg.path("sender").asText("");

                    String displayTitle = "[" + senderName + "] " + content;
                    if (displayTitle.length() > 150) {
                        displayTitle = displayTitle.substring(0, 150) + "...";
                    }

                    log.debug("[DingtalkScan] msg: id={}, sender={}, content={}",
                        msgId, senderName, content.length() > 50 ? content.substring(0, 50) : content);

                    if (scanLogService.isDuplicate(source.getSourceId(), msgId)) {
                        scanLogService.createItem(logId,
                            source.getSourceId(), displayTitle,
                            content, msgId, null, "duplicate");
                    } else {
                        ScanLogItem item = scanLogService.createItem(logId,
                            source.getSourceId(), displayTitle,
                            content, msgId, null, "created");
                        items.add(item);
                        createdCount++;
                    }
                }
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
