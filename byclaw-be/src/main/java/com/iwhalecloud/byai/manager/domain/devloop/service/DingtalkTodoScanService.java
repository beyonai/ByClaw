package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.entity.devloop.ScanLogItem;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.provider.dingtalk.DwsDingtalkAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 钉钉待办扫描服务
 * 通过 DWS CLI 拉取"派给我(执行人)"的未完成待办，按关键词过滤后去重写入扫描日志。
 * 与钉钉群消息扫描同一套 DWS + 授权体系；待办任务 id 作去重键，标题/描述转为需求条目。
 */
@Slf4j
@Service
public class DingtalkTodoScanService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String DWS_BIN = "dws";

    /** 单次拉取上限；DWS 超过 20 会自动分页，这里取一个够用的窗口。 */
    private static final String DEFAULT_SIZE = "50";

    @Autowired
    private ScanLogService scanLogService;

    @Autowired
    private ScanSourceService scanSourceService;

    @Autowired
    private DwsAuthService dwsAuthService;

    @Autowired
    private DwsDingtalkAuthorizationProvider dwsAuthorizationProvider;

    @Autowired
    private ConnectorInfoService connectorInfoService;

    /** 执行一次钉钉待办扫描，返回本次新增的条目列表；授权失败返回 null。 */
    public List<ScanLogItem> scan(ScanSource source) {
        List<ScanLogItem> items = new ArrayList<>();
        Long logId = null;

        try {
            if (!isAuthenticated(source.getCreateBy())) {
                log.error("[DingtalkTodoScan] DWS未授权，无法扫描。sourceId={}", source.getSourceId());
                return null;
            }

            JsonNode configNode = MAPPER.readTree(source.getConfig());
            // 关键词过滤:待办标题/描述需包含该词才视为研发需求,避免把日常琐事全涌进需求池。空则不过滤。
            String keyword = configNode.path("keyword").asText("");
            String corpId = configNode.path("corpId").asText("");
            // 优先级过滤(可选):如 "40,30" 只收紧急/较高;空则全部优先级。
            String priority = configNode.path("priority").asText("");

            log.info("[DingtalkTodoScan] sourceId={}, keyword={}, corpId={}, priority={}", source.getSourceId(),
                keyword, corpId, priority);

            var scanLog = scanLogService.createLog(source.getSourceId(), source.getProjectId());
            logId = scanLog.getLogId();

            // 固定拉"派给我(executor)"的未完成(status=false)待办;这是产品既定口径。
            List<String> cmd = new ArrayList<>();
            cmd.add(DWS_BIN);
            cmd.add("todo");
            cmd.add("task");
            cmd.add("list");
            cmd.add("--role-types");
            cmd.add("executor");
            cmd.add("--status");
            cmd.add("false");
            cmd.add("--size");
            cmd.add(DEFAULT_SIZE);
            cmd.add("--format");
            cmd.add("json");
            if (!priority.isEmpty()) {
                cmd.add("--priority");
                cmd.add(priority);
            }
            if (!corpId.isEmpty()) {
                cmd.add("--profile");
                cmd.add(corpId);
            }

            log.info("[DingtalkTodoScan] executing: {}", String.join(" ", cmd));

            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            Map<String, String> env = pb.environment();
            if (!env.containsKey("HOME")) {
                env.put("HOME", System.getProperty("user.home"));
            }
            // 按源创建者隔离 dws 环境(禁 keychain + DWS_CONFIG_DIR + XDG_DATA_HOME),读其专属授权(与群消息扫描一致)。
            dwsAuthService.applyUserDwsEnv(env, source.getCreateBy());
            Process process = pb.start();

            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line);
                }
            }

            boolean finished = process.waitFor(60, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                log.error("[DingtalkTodoScan] command timeout");
                scanLogService.failLog(logId, "DWS command timeout");
                return items;
            }

            log.info("[DingtalkTodoScan] exitCode={}, output={}", process.exitValue(), output.toString());

            if (process.exitValue() != 0) {
                String errDetail = output.toString();
                log.error("[DingtalkTodoScan] DWS command failed: exitCode={}, output={}", process.exitValue(),
                    errDetail);
                scanLogService.failLog(logId, "DWS exit code: " + process.exitValue() + ", output: "
                    + (errDetail.length() > 500 ? errDetail.substring(0, 500) : errDetail));
                return null;
            }

            // 待办列表在 result 数组;DWS 不同版本可能是 result 直接为数组或包一层,两种都兼容。
            JsonNode root = MAPPER.readTree(output.toString());
            JsonNode tasks = root.path("result");
            if (tasks.isObject()) {
                tasks = tasks.has("todoCards") ? tasks.path("todoCards") : tasks.path("list");
            }
            if (!tasks.isArray() || tasks.isEmpty()) {
                log.warn("[DingtalkTodoScan] no todo tasks found in response");
                scanLogService.completeLog(logId, 0, 0);
                scanSourceService.updateLastScanTime(source.getSourceId());
                return items;
            }

            int foundCount = 0;
            int createdCount = 0;

            for (JsonNode task : tasks) {
                // 字段名按钉钉待办 OpenAPI:subject=标题, description=描述, id=任务ID。做多名兜底以防版本差异。
                String title = firstNonEmpty(task, "subject", "title", "name");
                String description = firstNonEmpty(task, "description", "content", "detail");
                String taskId = firstNonEmpty(task, "id", "taskId", "todoId");
                if (taskId.isEmpty()) {
                    continue;
                }

                // 关键词过滤:标题或描述命中即可。
                if (!keyword.isEmpty() && !title.contains(keyword) && !description.contains(keyword)) {
                    continue;
                }
                foundCount++;

                String content = description.isEmpty() ? title : description;
                String displayTitle = title.isEmpty() ? content : title;
                if (displayTitle.length() > 150) {
                    displayTitle = displayTitle.substring(0, 150) + "...";
                }

                // 去重只认 created 行:待办 id 作 originId,重复项跳过不落库。
                if (scanLogService.isDuplicate(source.getSourceId(), taskId)) {
                    continue;
                }
                ScanLogItem item = scanLogService.createItem(logId, source.getSourceId(), displayTitle, content, taskId,
                    null, "created");
                items.add(item);
                createdCount++;
            }

            log.info("[DingtalkTodoScan] done: found={}, created={}", foundCount, createdCount);
            scanLogService.completeLog(logId, foundCount, createdCount);
            if (foundCount > 0) {
                scanSourceService.updateLastScanTime(source.getSourceId());
            }

        } catch (Exception e) {
            log.error("[DingtalkTodoScan] failed for source: {}", source.getSourceId(), e);
            if (logId != null) {
                scanLogService.failLog(logId, e.getMessage());
            }
        }
        return items;
    }

    private boolean isAuthenticated(String userId) {
        try {
            return dwsAuthorizationProvider.verify(
                Long.valueOf(userId), connectorInfoService.findByCode("dingtalk")
            ).status() == AuthorizationStatus.CONNECTED;
        } catch (RuntimeException e) {
            log.warn("[DingtalkTodoScan] 无法校验 DWS 授权，userId={}", userId, e);
            return false;
        }
    }

    /** 依次取候选字段的首个非空文本值,兼容不同版本的字段命名。 */
    private String firstNonEmpty(JsonNode node, String... fields) {
        for (String f : fields) {
            String v = node.path(f).asText("");
            if (v != null && !v.trim().isEmpty()) {
                return v.trim();
            }
        }
        return "";
    }
}
