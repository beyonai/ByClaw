package com.iwhalecloud.byai.gateway.sandbox.service;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ResizeSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ResizeSandboxResponse;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceProfileEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceProfileEntity;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxResizeRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxResizeRecordMapper;

@Service
public class SandboxResizeService {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxResizeService.class);
    private static final String STATUS_REQUESTED = "REQUESTED";
    private static final String STATUS_SUCCESS = "SUCCESS";
    private static final String STATUS_FAILED = "FAILED";
    private static final String STATUS_DEFERRED = "DEFERRED";
    private static final String STATUS_PROCESSING = "PROCESSING";
    private static final String STATUS_SKIPPED_NOOP = "SKIPPED_NOOP";
    private static final String STATUS_SKIPPED_BOUNDARY = "SKIPPED_BOUNDARY";
    private static final String STATUS_SKIPPED_INVALID = "SKIPPED_INVALID";
    private static final String STATUS_SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE";
    private static final String STATUS_SKIPPED_COOLDOWN = "SKIPPED_COOLDOWN";
    private static final String STATUS_SKIPPED_STALE = "SKIPPED_STALE";
    private static final String STATUS_RECORDED_OPS_INCIDENT = "RECORDED_OPS_INCIDENT";
    private static final String STATUS_RUNNING = "RUNNING";
    private static final String DIRECTION_UP = "UP";
    private static final String DIRECTION_DOWN = "DOWN";
    private static final String DIRECTION_MANUAL = "MANUAL";
    private static final String DEFAULT_TRIGGER_SOURCE = "MANUAL";
    private static final String DEFAULT_RESIZE_TYPE = "IN_PLACE";
    private static final String ALERT_ACTION_AUTOSCALE = "AUTOSCALE";
    private static final String ALERT_ACTION_ABNORMAL_RECOVERY = "ABNORMAL_RECOVERY";
    private static final String ALERT_ACTION_OPS_INCIDENT = "OPS_INCIDENT";
    private static final String RESIZE_TYPE_RECOVERY_RESTART = "RECOVERY_RESTART";
    private static final String RESIZE_TYPE_OPS_INCIDENT = "OPS_INCIDENT";
    private static final Duration COMPLETED_IDEMPOTENCY_REUSE_WINDOW = Duration.ofMinutes(2);

    private final SandboxProperties sandboxProperties;
    private final OpenSandboxClient openSandboxClient;
    private final SandboxServiceSpecRepository specRepository;
    private final SandboxServiceProfileEntityMapper profileEntityMapper;
    private final SsSandboxRecordMapper sandboxRecordMapper;
    private final SsSandboxResizeRecordMapper resizeRecordMapper;
    private final SandboxService sandboxService;
    private final SandboxHealthCacheService sandboxHealthCacheService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public SandboxResizeService(SandboxProperties sandboxProperties,
                                OpenSandboxClient openSandboxClient,
                                SandboxServiceSpecRepository specRepository,
                                SandboxServiceProfileEntityMapper profileEntityMapper,
                                @Lazy SsSandboxRecordMapper sandboxRecordMapper,
                                SsSandboxResizeRecordMapper resizeRecordMapper,
                                @Lazy SandboxService sandboxService,
                                SandboxHealthCacheService sandboxHealthCacheService) {
        this.sandboxProperties = sandboxProperties;
        this.openSandboxClient = openSandboxClient;
        this.specRepository = specRepository;
        this.profileEntityMapper = profileEntityMapper;
        this.sandboxRecordMapper = sandboxRecordMapper;
        this.resizeRecordMapper = resizeRecordMapper;
        this.sandboxService = sandboxService;
        this.sandboxHealthCacheService = sandboxHealthCacheService;
    }

    public SsSandboxResizeRecord handleResizeRequest(Map<String, Object> params) {
        if (sandboxProperties == null || sandboxProperties.getTierAutoscale() == null
            || !sandboxProperties.getTierAutoscale().isEnabled()) {
            throw new IllegalStateException("sandbox tier autoscale is disabled");
        }
        SsSandboxRecord record = resolveRecord(params);
        if (record == null || StringUtils.isBlank(record.getSandboxId())) {
            throw new IllegalArgumentException("running sandbox record not found");
        }

        String toProfileKey = firstNonBlank(params, "toProfileKey", "targetProfileKey", "to_profile_key",
            "target_profile_key");
        String triggerSource = StringUtils.defaultIfBlank(firstNonBlank(params, "triggerSource", "trigger_source",
                "source"),
            DEFAULT_TRIGGER_SOURCE);
        String reasonCode = StringUtils.defaultIfBlank(firstNonBlank(params, "reasonCode", "reason_code", "alertName"),
            "manual.resize");
        String reasonDetail = StringUtils.defaultIfBlank(firstNonBlank(params, "reasonDetail", "reason_detail",
                "description"),
            toJsonOrNull(params));
        String resizeType = StringUtils.defaultIfBlank(firstNonBlank(params, "resizeType", "resize_type",
                "suggestedResizeType", "suggested_resize_type", "strategy"),
            DEFAULT_RESIZE_TYPE);
        String serviceType = StringUtils.defaultIfBlank(record.getServiceType(), record.getSandboxType());
        String fromProfileKey = record.getProfileKey();
        if (StringUtils.isBlank(toProfileKey)) {
            if (isScaleUpAlert(reasonCode)) {
                toProfileKey = resolveNextProfileKey(serviceType, fromProfileKey);
            }
            else if (isScaleDownAlert(reasonCode)) {
                toProfileKey = resolveScaleDownProfileKey(serviceType, fromProfileKey, params);
            }
        }

        Date startedAt = new Date();
        String direction = resolveResizeDirection(serviceType, fromProfileKey, toProfileKey, reasonCode);
        String idempotencyKey = buildIdempotencyKey(record, serviceType, fromProfileKey, toProfileKey, resizeType,
            direction);
        SsSandboxResizeRecord reusableAudit = findReusableAudit(idempotencyKey, startedAt);
        if (reusableAudit != null) {
            LOGGER.info("沙箱扩缩容幂等命中，recordId={}，sandboxId={}，idempotencyKey={}，status={}",
                record.getId(), record.getSandboxId(), idempotencyKey, reusableAudit.getStatus());
            return reusableAudit;
        }
        SandboxServiceSpec targetSpec = null;
        if (StringUtils.isNotBlank(toProfileKey)) {
            targetSpec = specRepository.findByServiceKeyAndProfile(serviceType, toProfileKey).orElse(null);
        }

        if (StringUtils.isBlank(toProfileKey)) {
            String status = DIRECTION_UP.equals(direction) || DIRECTION_DOWN.equals(direction)
                ? STATUS_SKIPPED_BOUNDARY
                : STATUS_SKIPPED_INVALID;
            String message = DIRECTION_UP.equals(direction)
                ? "sandbox is already at the highest resize profile"
                : DIRECTION_DOWN.equals(direction)
                    ? "sandbox is already at the lowest resize profile"
                    : "target profile key is required";
            return buildSkippedAudit(record, serviceType, toProfileKey, triggerSource, reasonCode, reasonDetail,
                resizeType, targetSpec, startedAt, idempotencyKey, status, message, 0);
        }
        if (targetSpec == null) {
            return buildSkippedAudit(record, serviceType, toProfileKey, triggerSource, reasonCode, reasonDetail,
                resizeType, null, startedAt, idempotencyKey, STATUS_SKIPPED_INVALID,
                "target profile is not enabled or not found", 0);
        }

        String resolvedToProfileKey = StringUtils.defaultIfBlank(targetSpec.getProfileKey(), toProfileKey);
        if (StringUtils.equalsIgnoreCase(fromProfileKey, resolvedToProfileKey)) {
            return buildSkippedAudit(record, serviceType, resolvedToProfileKey, triggerSource, reasonCode,
                reasonDetail, resizeType, targetSpec, startedAt, idempotencyKey, STATUS_SKIPPED_NOOP,
                "sandbox is already running on target profile", 1);
        }
        if ("PREFERRED_ONLY".equalsIgnoreCase(resizeType)) {
            SsSandboxResizeRecord audit = buildRequestedAudit(record, serviceType, resolvedToProfileKey,
                triggerSource, reasonCode, reasonDetail, resizeType, targetSpec, startedAt);
            audit.setIdempotencyKey(idempotencyKey);
            resizeRecordMapper.insert(audit);
            sandboxService.savePreferredServiceKey(record.getUserCode(), serviceType + "-" + toProfileKey);
            finishDeferred(audit, "preferred profile will apply on next sandbox start", 1);
            return audit;
        }
        if (!STATUS_RUNNING.equalsIgnoreCase(record.getStatus())) {
            if (DIRECTION_UP.equals(direction)) {
                return handleNonRunningScaleUp(record, serviceType, resolvedToProfileKey, triggerSource, reasonCode,
                    reasonDetail, resizeType, targetSpec, startedAt, idempotencyKey);
            }
            return buildSkippedAudit(record, serviceType, resolvedToProfileKey, triggerSource, reasonCode,
                reasonDetail, resizeType, targetSpec, startedAt, idempotencyKey, STATUS_SKIPPED_INVALID,
                "sandbox is not running and cannot be resized in place", 1);
        }
        if (isCooldownActive(record, direction, startedAt)) {
            return buildSkippedAudit(record, serviceType, resolvedToProfileKey, triggerSource, reasonCode,
                reasonDetail, resizeType, targetSpec, startedAt, idempotencyKey, STATUS_SKIPPED_COOLDOWN,
                "sandbox resize cooldown is active", 1);
        }
        if (isScaleDownProtectedAfterRecentUp(record, direction, startedAt)) {
            return buildSkippedAudit(record, serviceType, resolvedToProfileKey, triggerSource, reasonCode,
                reasonDetail, resizeType, targetSpec, startedAt, idempotencyKey, STATUS_SKIPPED_COOLDOWN,
                "sandbox scale-down is protected after recent scale-up or OOM handling", 1);
        }
        Date processingStaleBefore = new Date(startedAt.getTime()
            - toMillis(getTierAutoscaleConfig().getProcessingTimeout()));
        int claimed = sandboxRecordMapper.claimResize(record.getId(), fromProfileKey, resolvedToProfileKey,
            STATUS_PROCESSING, startedAt, reasonDetail, null, fromProfileKey, resolvedToProfileKey, null,
            processingStaleBefore, record.getLockVersion());
        if (claimed != 1) {
            return buildSkippedAudit(record, serviceType, resolvedToProfileKey, triggerSource, reasonCode,
                reasonDetail, resizeType, targetSpec, startedAt, idempotencyKey, STATUS_SKIPPED_DUPLICATE,
                "another resize action already claimed this sandbox or the sandbox profile changed", 1);
        }

        SsSandboxResizeRecord audit = buildRequestedAudit(record, serviceType, resolvedToProfileKey, triggerSource,
            reasonCode, reasonDetail, resizeType, targetSpec, startedAt);
        audit.setStatus(STATUS_PROCESSING);
        audit.setIdempotencyKey(idempotencyKey);
        resizeRecordMapper.insert(audit);

        long startMillis = System.currentTimeMillis();
        try {
            ResizeSandboxRequest request = ResizeSandboxRequest.builder()
                .resourceRequests(targetSpec.getResourceRequests())
                .resourceLimits(targetSpec.getResourceLimits())
                .resizeType(resizeType)
                .metadata(buildResizeMetadata(record, audit, resolvedToProfileKey, reasonCode))
                .build();
            ResizeSandboxResponse response = openSandboxClient.resizeSandbox(record.getSandboxId(), request);
            Date finishedAt = new Date();
            long durationMs = System.currentTimeMillis() - startMillis;
            String responseJson = toJsonOrNull(response);
            String requestId = response != null
                ? StringUtils.defaultIfBlank(response.getRequestId(), response.getOperationId())
                : null;
            String newSandboxId = response != null && StringUtils.isNotBlank(response.getSandboxId())
                ? response.getSandboxId()
                : null;
            int updated = sandboxRecordMapper.updateResizeSuccess(record.getId(), newSandboxId, null, null,
                resolvedToProfileKey, toJsonOrNull(targetSpec.getResourceRequests()),
                toJsonOrNull(targetSpec.getResourceLimits()), STATUS_SUCCESS, finishedAt, reasonDetail,
                durationMs, 1, fromProfileKey, resolvedToProfileKey, null,
                record.getLockVersion());
            if (updated != 1) {
                String message = "resize completed but local sandbox record state changed before result update";
                resizeRecordMapper.updateResult(audit.getId(), STATUS_SKIPPED_STALE, 0, finishedAt, durationMs,
                    requestId, responseJson, message);
                audit.setStatus(STATUS_SKIPPED_STALE);
                audit.setSuccess(0);
                audit.setFinishedAt(finishedAt);
                audit.setDurationMs(durationMs);
                audit.setOpensandboxRequestId(requestId);
                audit.setOpensandboxResponse(responseJson);
                audit.setErrorMessage(message);
                audit.setSkipReason(message);
                LOGGER.warn("沙箱扩缩容结果写回被跳过，recordId={}，sandboxId={}，fromProfile={}，toProfile={}，原因：{}",
                    record.getId(), record.getSandboxId(), fromProfileKey, resolvedToProfileKey, message);
                cleanupResizeRemoteAfterStaleWrite(record, newSandboxId);
                return audit;
            }
            resizeRecordMapper.updateResult(audit.getId(), STATUS_SUCCESS, 1, finishedAt, durationMs,
                requestId, responseJson, null);
            audit.setStatus(STATUS_SUCCESS);
            audit.setSuccess(1);
            audit.setFinishedAt(finishedAt);
            audit.setDurationMs(durationMs);
            audit.setOpensandboxRequestId(requestId);
            audit.setOpensandboxResponse(responseJson);

            cleanupReplacedRemoteAfterResize(record, newSandboxId);
            sandboxHealthCacheService.evictSnapshot(record.getUserCode(), serviceType);
            LOGGER.info("沙箱扩缩容成功，recordId={}，sandboxId={}，fromProfile={}，toProfile={}，durationMs={}",
                record.getId(), record.getSandboxId(), fromProfileKey, resolvedToProfileKey, durationMs);
            return audit;
        }
        catch (Exception e) {
            Date finishedAt = new Date();
            long durationMs = System.currentTimeMillis() - startMillis;
            resizeRecordMapper.updateResult(audit.getId(), STATUS_FAILED, 0, finishedAt, durationMs,
                null, null, e.getMessage());
            sandboxRecordMapper.updateResizeSummary(record.getId(), STATUS_FAILED, finishedAt, reasonDetail,
                durationMs, 0, fromProfileKey, resolvedToProfileKey, e.getMessage(), record.getLockVersion());
            audit.setStatus(STATUS_FAILED);
            audit.setSuccess(0);
            audit.setFinishedAt(finishedAt);
            audit.setDurationMs(durationMs);
            audit.setErrorMessage(e.getMessage());
            LOGGER.warn("沙箱扩缩容失败，recordId={}，sandboxId={}，toProfile={}，原因：{}",
                record.getId(), record.getSandboxId(), resolvedToProfileKey, e.getMessage());
            return audit;
        }
    }

    private void cleanupReplacedRemoteAfterResize(SsSandboxRecord record, String newSandboxId) {
        if (record == null || StringUtils.isAnyBlank(record.getSandboxId(), newSandboxId)
            || StringUtils.equals(record.getSandboxId(), newSandboxId)) {
            return;
        }
        sandboxService.cleanupRemoteSandboxQuietly(record.getUserCode(), record.getSandboxType(),
            record.getSandboxId(), "resize-replaced");
    }

    private void cleanupResizeRemoteAfterStaleWrite(SsSandboxRecord record, String newSandboxId) {
        if (record == null) {
            return;
        }
        String sandboxIdToCleanup = StringUtils.defaultIfBlank(newSandboxId, record.getSandboxId());
        if (StringUtils.isBlank(sandboxIdToCleanup)) {
            return;
        }
        sandboxService.cleanupRemoteSandboxQuietly(record.getUserCode(), record.getSandboxType(),
            sandboxIdToCleanup, "resize-stale-writeback");
    }

    public String buildBoundaryBlacklistMetrics() {
        StringBuilder metrics = new StringBuilder();
        metrics.append("# HELP byclaw_sandbox_autoscale_runtime_info ")
            .append("Active sandbox metadata used to enrich autoscale alerts.\n");
        metrics.append("# TYPE byclaw_sandbox_autoscale_runtime_info gauge\n");
        metrics.append("# HELP byclaw_sandbox_autoscale_boundary_blacklist ")
            .append("Active sandboxes that are already at an autoscale boundary and should be ignored by same-direction alerts.\n");
        metrics.append("# TYPE byclaw_sandbox_autoscale_boundary_blacklist gauge\n");
        if (sandboxProperties == null || sandboxProperties.getTierAutoscale() == null
            || !sandboxProperties.getTierAutoscale().isEnabled()) {
            return metrics.toString();
        }
        List<SsSandboxRecord> records = sandboxRecordMapper.selectRunningAutoscaleRecords();
        if (records == null || records.isEmpty()) {
            return metrics.toString();
        }
        Map<String, ProfileBoundary> boundaryByServiceType = new HashMap<>();
        for (SsSandboxRecord record : records) {
            if (record == null || StringUtils.isAnyBlank(record.getSandboxId(), record.getProfileKey())) {
                continue;
            }
            String serviceType = StringUtils.defaultIfBlank(record.getServiceType(), record.getSandboxType());
            if (StringUtils.isBlank(serviceType)) {
                continue;
            }
            appendRuntimeInfoMetric(metrics, record, serviceType);
            ProfileBoundary boundary = boundaryByServiceType.computeIfAbsent(serviceType, this::resolveProfileBoundary);
            if (boundary == null || !boundary.isValid()) {
                continue;
            }
            if (record.getProfileKey().equalsIgnoreCase(boundary.maxProfileKey())) {
                appendBoundaryBlacklistMetric(metrics, record, serviceType, "up", "max");
            }
            if (record.getProfileKey().equalsIgnoreCase(boundary.minProfileKey())) {
                appendBoundaryBlacklistMetric(metrics, record, serviceType, "down", "min");
            }
        }
        return metrics.toString();
    }

    @SuppressWarnings("unchecked")
    public SsSandboxResizeRecord handlePrometheusAlert(Map<String, Object> payload) {
        Map<String, Object> params = new LinkedHashMap<>();
        if (payload == null) {
            return buildPayloadSkippedAudit("prometheus alert payload is empty");
        }
        Object alertsObj = payload.get("alerts");
        if (alertsObj instanceof Iterable<?> alerts) {
            for (Object item : alerts) {
                if (item instanceof Map<?, ?> alert) {
                    if (isResolvedAlert(alert)) {
                        continue;
                    }
                    copyNestedMap(params, (Map<String, Object>) alert.get("labels"));
                    copyNestedMap(params, (Map<String, Object>) alert.get("annotations"));
                    break;
                }
            }
        }
        if (params.isEmpty() && isResolvedAlert(payload)) {
            return buildPayloadSkippedAudit("prometheus alert is resolved");
        }
        copyNestedMap(params, (Map<String, Object>) payload.get("labels"));
        copyNestedMap(params, (Map<String, Object>) payload.get("annotations"));
        params.putIfAbsent("triggerSource", "PROMETHEUS_ALERT");
        params.putIfAbsent("reasonCode", "prometheus.alert");
        params.putIfAbsent("reasonDetail", toJsonOrNull(payload));
        String alertActionType = resolveAlertActionType(params);
        params.putIfAbsent("alertActionType", alertActionType);
        if (ALERT_ACTION_OPS_INCIDENT.equals(alertActionType)) {
            return recordOpsIncident(params);
        }
        if (ALERT_ACTION_ABNORMAL_RECOVERY.equals(alertActionType)) {
            return handleAbnormalRecoveryRequest(params);
        }
        return handleResizeRequest(params);
    }

    private SsSandboxResizeRecord handleAbnormalRecoveryRequest(Map<String, Object> params) {
        if (sandboxProperties == null || sandboxProperties.getTierAutoscale() == null
            || !sandboxProperties.getTierAutoscale().isEnabled()) {
            throw new IllegalStateException("sandbox tier autoscale is disabled");
        }
        SsSandboxRecord record = resolveRecord(params);
        if (record == null || StringUtils.isBlank(record.getSandboxId())) {
            throw new IllegalArgumentException("sandbox record not found for abnormal recovery alert");
        }

        String triggerSource = StringUtils.defaultIfBlank(firstNonBlank(params, "triggerSource", "trigger_source",
                "source"),
            "PROMETHEUS_ALERT");
        String reasonCode = StringUtils.defaultIfBlank(firstNonBlank(params, "reasonCode", "reason_code", "alertName"),
            "sandbox.abnormal_recovery");
        String reasonDetail = StringUtils.defaultIfBlank(firstNonBlank(params, "reasonDetail", "reason_detail",
                "description"),
            toJsonOrNull(params));
        String serviceType = StringUtils.defaultIfBlank(record.getServiceType(), record.getSandboxType());
        String fromProfileKey = record.getProfileKey();
        String toProfileKey = firstNonBlank(params, "toProfileKey", "targetProfileKey", "to_profile_key",
            "target_profile_key");
        if (StringUtils.isBlank(toProfileKey) && isScaleUpAlert(reasonCode)) {
            toProfileKey = resolveNextProfileKey(serviceType, fromProfileKey);
        }
        toProfileKey = StringUtils.defaultIfBlank(toProfileKey, fromProfileKey);

        Date startedAt = new Date();
        SandboxServiceSpec targetSpec = StringUtils.isNotBlank(toProfileKey)
            ? specRepository.findByServiceKeyAndProfile(serviceType, toProfileKey).orElse(null)
            : null;
        if (targetSpec == null) {
            return buildSkippedAudit(record, serviceType, toProfileKey, triggerSource, reasonCode, reasonDetail,
                RESIZE_TYPE_RECOVERY_RESTART, null, startedAt, buildRecoveryIdempotencyKey(record, toProfileKey,
                    reasonCode), STATUS_SKIPPED_INVALID, "target profile is not enabled or not found", 0);
        }
        String resolvedToProfileKey = StringUtils.defaultIfBlank(targetSpec.getProfileKey(), toProfileKey);
        String idempotencyKey = buildRecoveryIdempotencyKey(record, resolvedToProfileKey, reasonCode);
        SsSandboxResizeRecord reusableAudit = findReusableAudit(idempotencyKey, startedAt);
        if (reusableAudit != null) {
            LOGGER.info("沙箱异常恢复幂等命中，recordId={}，sandboxId={}，idempotencyKey={}，status={}",
                record.getId(), record.getSandboxId(), idempotencyKey, reusableAudit.getStatus());
            return reusableAudit;
        }
        return handleRecoveryRestart(record, serviceType, resolvedToProfileKey, triggerSource, reasonCode,
            reasonDetail, targetSpec, startedAt, idempotencyKey);
    }

    private SsSandboxResizeRecord recordOpsIncident(Map<String, Object> params) {
        if (sandboxProperties == null || sandboxProperties.getTierAutoscale() == null
            || !sandboxProperties.getTierAutoscale().isEnabled()) {
            throw new IllegalStateException("sandbox tier autoscale is disabled");
        }
        SsSandboxRecord record = resolveRecord(params);
        if (record == null || StringUtils.isBlank(record.getSandboxId())) {
            return buildPayloadSkippedAudit("sandbox record not found for operations incident alert");
        }

        String triggerSource = StringUtils.defaultIfBlank(firstNonBlank(params, "triggerSource", "trigger_source",
                "source"),
            "PROMETHEUS_ALERT");
        String reasonCode = StringUtils.defaultIfBlank(firstNonBlank(params, "reasonCode", "reason_code", "alertName"),
            "ops.incident");
        String reasonDetail = StringUtils.defaultIfBlank(firstNonBlank(params, "reasonDetail", "reason_detail",
                "description"),
            toJsonOrNull(params));
        String serviceType = StringUtils.defaultIfBlank(record.getServiceType(), record.getSandboxType());
        String profileKey = record.getProfileKey();
        Date startedAt = new Date();
        String idempotencyKey = buildOpsIncidentIdempotencyKey(record, params, reasonCode);
        SsSandboxResizeRecord reusableAudit = findReusableAudit(idempotencyKey, startedAt);
        if (reusableAudit != null) {
            LOGGER.info("沙箱运维异常幂等命中，recordId={}，sandboxId={}，idempotencyKey={}，status={}",
                record.getId(), record.getSandboxId(), idempotencyKey, reusableAudit.getStatus());
            return reusableAudit;
        }

        SandboxServiceSpec currentSpec = StringUtils.isNotBlank(profileKey)
            ? specRepository.findByServiceKeyAndProfile(serviceType, profileKey).orElse(null)
            : null;
        SsSandboxResizeRecord audit = buildRequestedAudit(record, serviceType, profileKey, triggerSource, reasonCode,
            reasonDetail, RESIZE_TYPE_OPS_INCIDENT, currentSpec, startedAt);
        audit.setStatus(STATUS_RECORDED_OPS_INCIDENT);
        audit.setSuccess(1);
        audit.setFinishedAt(startedAt);
        audit.setDurationMs(0L);
        audit.setSkipReason("operations incident recorded only");
        audit.setIdempotencyKey(idempotencyKey);
        resizeRecordMapper.insert(audit);
        LOGGER.warn("沙箱运维异常已记录，recordId={}，sandboxId={}，reasonCode={}，alertname={}，pod={}",
            record.getId(), record.getSandboxId(), reasonCode, firstNonBlank(params, "alertname", "alertName"),
            firstNonBlank(params, "pod"));
        return audit;
    }

    private SsSandboxRecord resolveRecord(Map<String, Object> params) {
        Long recordId = parseLong(params != null ? params.get("sandboxRecordId") : null);
        if (recordId == null) {
            recordId = parseLong(params != null ? params.get("recordId") : null);
        }
        if (recordId != null) {
            return sandboxRecordMapper.selectById(recordId);
        }
        String userCode = firstNonBlank(params, "userCode", "user_code");
        String sandboxId = normalizeSandboxId(firstNonBlank(params, "sandboxId", "sandbox_id", "pod"));
        String sandboxType = StringUtils.defaultIfBlank(firstNonBlank(params, "sandboxType", "sandbox_type",
                "serviceType", "service_type"),
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);
        if (StringUtils.isBlank(sandboxId)) {
            return null;
        }
        if (StringUtils.isBlank(userCode)) {
            return sandboxRecordMapper.selectLatestBySandboxIdAnyUser(sandboxId);
        }
        return sandboxRecordMapper.selectLatestBySandboxId(userCode, sandboxType, sandboxId);
    }

    private boolean isScaleUpAlert(String reasonCode) {
        return StringUtils.containsIgnoreCase(reasonCode, "high")
            || StringUtils.containsIgnoreCase(reasonCode, "critical")
            || StringUtils.containsIgnoreCase(reasonCode, "oom");
    }

    private boolean isScaleDownAlert(String reasonCode) {
        return StringUtils.containsIgnoreCase(reasonCode, "low")
            || StringUtils.containsIgnoreCase(reasonCode, "idle")
            || StringUtils.containsIgnoreCase(reasonCode, "underutilized");
    }

    private String resolveAlertActionType(Map<String, Object> params) {
        String actionType = firstNonBlank(params, "alertActionType", "alert_action_type", "actionType",
            "action_type");
        if (StringUtils.isNotBlank(actionType)) {
            String normalized = actionType.trim().toUpperCase(Locale.ROOT);
            if (ALERT_ACTION_AUTOSCALE.equals(normalized) || ALERT_ACTION_ABNORMAL_RECOVERY.equals(normalized)
                || ALERT_ACTION_OPS_INCIDENT.equals(normalized)) {
                return normalized;
            }
        }

        String signal = StringUtils.joinWith(" ",
            firstNonBlank(params, "reasonCode", "reason_code"),
            firstNonBlank(params, "alertname", "alertName"),
            firstNonBlank(params, "reason", "kubeReason"));
        if (containsAnyIgnoreCase(signal, "imagepullbackoff", "errimagepull", "invalidimagename",
            "image_pull", "harbor", "tag", "service_unavailable", "not_ready")) {
            return ALERT_ACTION_OPS_INCIDENT;
        }
        if (containsAnyIgnoreCase(signal, "oom", "crashloopbackoff", "runcontainererror",
            "createcontainerconfigerror", "createcontainererror", "startup_failed", "restart_loop",
            "restart")) {
            return ALERT_ACTION_ABNORMAL_RECOVERY;
        }
        return ALERT_ACTION_AUTOSCALE;
    }

    private boolean containsAnyIgnoreCase(String value, String... needles) {
        if (StringUtils.isBlank(value) || needles == null) {
            return false;
        }
        for (String needle : needles) {
            if (StringUtils.containsIgnoreCase(value, needle)) {
                return true;
            }
        }
        return false;
    }

    private SandboxProperties.TierAutoscaleConfig getTierAutoscaleConfig() {
        return sandboxProperties != null && sandboxProperties.getTierAutoscale() != null
            ? sandboxProperties.getTierAutoscale()
            : new SandboxProperties.TierAutoscaleConfig();
    }

    private ProfileBoundary resolveProfileBoundary(String serviceType) {
        if (profileEntityMapper == null || StringUtils.isBlank(serviceType)) {
            return null;
        }
        try {
            List<SandboxServiceProfileEntity> profiles = profileEntityMapper.selectEnabledProfiles(serviceType);
            if (profiles == null || profiles.isEmpty()) {
                return null;
            }
            String minProfileKey = null;
            String maxProfileKey = null;
            for (SandboxServiceProfileEntity profile : profiles) {
                if (profile == null || profile.getResizeEnabled() != null && profile.getResizeEnabled() == 0) {
                    continue;
                }
                String profileKey = profile.getProfileKey();
                if (StringUtils.isBlank(profileKey)) {
                    continue;
                }
                if (minProfileKey == null) {
                    minProfileKey = profileKey;
                }
                maxProfileKey = profileKey;
            }
            return new ProfileBoundary(minProfileKey, maxProfileKey);
        }
        catch (Exception e) {
            LOGGER.warn("解析沙箱扩缩容边界失败，serviceType={}，原因：{}", serviceType, e.getMessage());
            return null;
        }
    }

    private void appendBoundaryBlacklistMetric(StringBuilder metrics,
                                               SsSandboxRecord record,
                                               String serviceType,
                                               String direction,
                                               String boundary) {
        String pod = resolveAutoscalePodName(record);
        metrics.append("byclaw_sandbox_autoscale_boundary_blacklist{")
            .append("sandboxId=\"").append(escapePrometheusMetricLabel(record.getSandboxId())).append("\",")
            .append("pod=\"").append(escapePrometheusMetricLabel(pod)).append("\",")
            .append("userCode=\"").append(escapePrometheusMetricLabel(record.getUserCode())).append("\",")
            .append("serviceType=\"").append(escapePrometheusMetricLabel(serviceType)).append("\",")
            .append("profileKey=\"").append(escapePrometheusMetricLabel(record.getProfileKey())).append("\",")
            .append("direction=\"").append(direction).append("\",")
            .append("boundary=\"").append(boundary).append("\"")
            .append("} 1\n");
    }

    private void appendRuntimeInfoMetric(StringBuilder metrics, SsSandboxRecord record, String serviceType) {
        String pod = resolveAutoscalePodName(record);
        metrics.append("byclaw_sandbox_autoscale_runtime_info{")
            .append("sandboxId=\"").append(escapePrometheusMetricLabel(record.getSandboxId())).append("\",")
            .append("pod=\"").append(escapePrometheusMetricLabel(pod)).append("\",")
            .append("userCode=\"").append(escapePrometheusMetricLabel(record.getUserCode())).append("\",")
            .append("serviceType=\"").append(escapePrometheusMetricLabel(serviceType)).append("\",")
            .append("profileKey=\"").append(escapePrometheusMetricLabel(record.getProfileKey())).append("\"")
            .append("} 1\n");
    }

    private String resolveAutoscalePodName(SsSandboxRecord record) {
        return record.getSandboxId() + StringUtils.defaultString(
            getTierAutoscaleConfig().getBoundaryBlacklistPodSuffix(), "-0");
    }

    private String resolveResizeDirection(String serviceType, String fromProfileKey, String toProfileKey,
                                          String reasonCode) {
        if (isScaleUpAlert(reasonCode)) {
            return DIRECTION_UP;
        }
        if (isScaleDownAlert(reasonCode)) {
            return DIRECTION_DOWN;
        }
        return resolveProfileDirection(serviceType, fromProfileKey, toProfileKey);
    }

    private String resolveProfileDirection(String serviceType, String fromProfileKey, String toProfileKey) {
        if (StringUtils.isAnyBlank(serviceType, fromProfileKey, toProfileKey)
            || StringUtils.equalsIgnoreCase(fromProfileKey, toProfileKey)
            || profileEntityMapper == null) {
            return DIRECTION_MANUAL;
        }
        try {
            List<SandboxServiceProfileEntity> profiles = profileEntityMapper.selectEnabledProfiles(serviceType);
            int fromIndex = -1;
            int toIndex = -1;
            int index = 0;
            for (SandboxServiceProfileEntity profile : profiles) {
                if (profile == null || profile.getResizeEnabled() != null && profile.getResizeEnabled() == 0) {
                    continue;
                }
                String profileKey = profile.getProfileKey();
                if (StringUtils.isBlank(profileKey)) {
                    continue;
                }
                if (profileKey.equalsIgnoreCase(fromProfileKey)) {
                    fromIndex = index;
                }
                if (profileKey.equalsIgnoreCase(toProfileKey)) {
                    toIndex = index;
                }
                index++;
            }
            if (fromIndex >= 0 && toIndex >= 0) {
                if (toIndex > fromIndex) {
                    return DIRECTION_UP;
                }
                if (toIndex < fromIndex) {
                    return DIRECTION_DOWN;
                }
            }
        }
        catch (Exception e) {
            LOGGER.warn("解析扩缩容方向失败，serviceType={}，fromProfile={}，toProfile={}，原因：{}",
                serviceType, fromProfileKey, toProfileKey, e.getMessage());
        }
        return DIRECTION_MANUAL;
    }

    private boolean isCooldownActive(SsSandboxRecord record, String direction, Date now) {
        if (record == null || record.getLastResizeAt() == null || record.getLastResizeSuccess() == null
            || record.getLastResizeSuccess() != 1) {
            return false;
        }
        Duration cooldown = DIRECTION_DOWN.equals(direction)
            ? getTierAutoscaleConfig().getScaleDownCooldown()
            : DIRECTION_UP.equals(direction) ? getTierAutoscaleConfig().getScaleUpCooldown() : Duration.ZERO;
        long cooldownMillis = toMillis(cooldown);
        return cooldownMillis > 0 && now.getTime() - record.getLastResizeAt().getTime() < cooldownMillis;
    }

    private boolean isScaleDownProtectedAfterRecentUp(SsSandboxRecord record, String direction, Date now) {
        if (!DIRECTION_DOWN.equals(direction) || record == null || record.getLastResizeAt() == null
            || record.getLastResizeSuccess() == null || record.getLastResizeSuccess() != 1) {
            return false;
        }
        long protectionMillis = toMillis(getTierAutoscaleConfig().getScaleDownAfterUpProtection());
        if (protectionMillis <= 0 || now.getTime() - record.getLastResizeAt().getTime() >= protectionMillis) {
            return false;
        }
        String previousDirection = resolveProfileDirection(
            StringUtils.defaultIfBlank(record.getServiceType(), record.getSandboxType()),
            record.getLastResizeFromProfile(), record.getLastResizeToProfile());
        return DIRECTION_UP.equals(previousDirection) || isScaleUpAlert(record.getLastResizeReason());
    }

    private SsSandboxResizeRecord handleRecoveryRestart(SsSandboxRecord record,
                                                        String serviceType,
                                                        String resolvedToProfileKey,
                                                        String triggerSource,
                                                        String reasonCode,
                                                        String reasonDetail,
                                                        SandboxServiceSpec targetSpec,
                                                        Date startedAt,
                                                        String idempotencyKey) {
        SsSandboxResizeRecord audit = buildRequestedAudit(record, serviceType, resolvedToProfileKey, triggerSource,
            reasonCode, reasonDetail, RESIZE_TYPE_RECOVERY_RESTART, targetSpec, startedAt);
        audit.setStatus(STATUS_PROCESSING);
        audit.setIdempotencyKey(idempotencyKey);
        resizeRecordMapper.insert(audit);

        long startMillis = System.currentTimeMillis();
        String preferredServiceKey = serviceType + "-" + resolvedToProfileKey;
        try {
            sandboxService.savePreferredServiceKey(record.getUserCode(), preferredServiceKey);
            SandboxLaunchData launchData = sandboxService.restartSandboxAfterRemoteExitWithoutWait(
                record.getUserCode(), record.getResourceId(), null, serviceType);
            if (launchData == null || StringUtils.isBlank(launchData.getSandboxId())) {
                throw new IllegalStateException("recovery restart did not return a sandbox id");
            }
            if (StringUtils.equals(launchData.getSandboxId(), record.getSandboxId())) {
                throw new IllegalStateException("recovery restart reused the old sandbox id: "
                    + record.getSandboxId());
            }
            Date finishedAt = new Date();
            long durationMs = System.currentTimeMillis() - startMillis;
            String responseJson = toJsonOrNull(launchData);
            resizeRecordMapper.updateResult(audit.getId(), STATUS_SUCCESS, 1, finishedAt, durationMs,
                null, responseJson, null);
            audit.setStatus(STATUS_SUCCESS);
            audit.setSuccess(1);
            audit.setFinishedAt(finishedAt);
            audit.setDurationMs(durationMs);
            audit.setOpensandboxResponse(responseJson);
            sandboxHealthCacheService.evictSnapshot(record.getUserCode(), serviceType);
            LOGGER.warn("沙箱异常自动恢复已重启，recordId={}，sandboxId={}，status={}，targetProfile={}，preferredServiceKey={}，reasonCode={}",
                record.getId(), record.getSandboxId(), record.getStatus(), resolvedToProfileKey, preferredServiceKey,
                reasonCode);
            return audit;
        }
        catch (Exception e) {
            Date finishedAt = new Date();
            long durationMs = System.currentTimeMillis() - startMillis;
            resizeRecordMapper.updateResult(audit.getId(), STATUS_FAILED, 0, finishedAt, durationMs,
                null, null, e.getMessage());
            audit.setStatus(STATUS_FAILED);
            audit.setSuccess(0);
            audit.setFinishedAt(finishedAt);
            audit.setDurationMs(durationMs);
            audit.setErrorMessage(e.getMessage());
            LOGGER.warn("沙箱异常自动恢复失败，recordId={}，sandboxId={}，status={}，targetProfile={}，reasonCode={}，原因={}",
                record.getId(), record.getSandboxId(), record.getStatus(), resolvedToProfileKey, reasonCode,
                e.getMessage());
            return audit;
        }
    }

    private SsSandboxResizeRecord handleNonRunningScaleUp(SsSandboxRecord record,
                                                          String serviceType,
                                                          String resolvedToProfileKey,
                                                          String triggerSource,
                                                          String reasonCode,
                                                          String reasonDetail,
                                                          String resizeType,
                                                          SandboxServiceSpec targetSpec,
                                                          Date startedAt,
                                                          String idempotencyKey) {
        SsSandboxResizeRecord audit = buildRequestedAudit(record, serviceType, resolvedToProfileKey, triggerSource,
            reasonCode, reasonDetail, resizeType, targetSpec, startedAt);
        audit.setStatus(STATUS_PROCESSING);
        audit.setIdempotencyKey(idempotencyKey);
        resizeRecordMapper.insert(audit);

        long startMillis = System.currentTimeMillis();
        String preferredServiceKey = serviceType + "-" + resolvedToProfileKey;
        try {
            sandboxService.savePreferredServiceKey(record.getUserCode(), preferredServiceKey);
            SandboxLaunchData launchData = sandboxService.restartSandboxAfterRemoteExitWithoutWait(
                record.getUserCode(), record.getResourceId(), null, serviceType);
            Date finishedAt = new Date();
            long durationMs = System.currentTimeMillis() - startMillis;
            String responseJson = toJsonOrNull(launchData);
            String message = "sandbox was not running; preferred profile saved and sandbox restarted";
            resizeRecordMapper.updateResult(audit.getId(), STATUS_SUCCESS, 1, finishedAt, durationMs,
                null, responseJson, null);
            audit.setStatus(STATUS_SUCCESS);
            audit.setSuccess(1);
            audit.setFinishedAt(finishedAt);
            audit.setDurationMs(durationMs);
            audit.setOpensandboxResponse(responseJson);
            sandboxHealthCacheService.evictSnapshot(record.getUserCode(), serviceType);
            LOGGER.warn("非运行态沙箱扩容已转为升配重拉，recordId={}，sandboxId={}，status={}，targetProfile={}，preferredServiceKey={}，message={}",
                record.getId(), record.getSandboxId(), record.getStatus(), resolvedToProfileKey, preferredServiceKey,
                message);
            return audit;
        }
        catch (Exception e) {
            Date finishedAt = new Date();
            long durationMs = System.currentTimeMillis() - startMillis;
            resizeRecordMapper.updateResult(audit.getId(), STATUS_FAILED, 0, finishedAt, durationMs,
                null, null, e.getMessage());
            audit.setStatus(STATUS_FAILED);
            audit.setSuccess(0);
            audit.setFinishedAt(finishedAt);
            audit.setDurationMs(durationMs);
            audit.setErrorMessage(e.getMessage());
            LOGGER.warn("非运行态沙箱升配重拉失败，recordId={}，sandboxId={}，status={}，targetProfile={}，原因={}",
                record.getId(), record.getSandboxId(), record.getStatus(), resolvedToProfileKey, e.getMessage());
            return audit;
        }
    }

    private long toMillis(Duration duration) {
        if (duration == null || duration.isNegative() || duration.isZero()) {
            return 0L;
        }
        return duration.toMillis();
    }

    private String buildIdempotencyKey(SsSandboxRecord record, String serviceType, String fromProfileKey,
                                       String toProfileKey, String resizeType, String direction) {
        return String.join(":",
            "sandbox-resize",
            normalizeKey(record != null ? record.getId() : null),
            normalizeKey(record != null ? record.getSandboxId() : null),
            normalizeKey(serviceType),
            normalizeKey(direction),
            normalizeKey(fromProfileKey),
            normalizeKey(toProfileKey),
            normalizeKey(resizeType)
        );
    }

    private String buildRecoveryIdempotencyKey(SsSandboxRecord record, String targetProfileKey, String reasonCode) {
        return String.join(":",
            "sandbox-recovery",
            normalizeKey(record != null ? record.getId() : null),
            normalizeKey(record != null ? record.getSandboxId() : null),
            normalizeKey(reasonCode),
            normalizeKey(targetProfileKey)
        );
    }

    private String buildOpsIncidentIdempotencyKey(SsSandboxRecord record, Map<String, Object> params,
                                                  String reasonCode) {
        return String.join(":",
            "sandbox-ops-incident",
            normalizeKey(record != null ? record.getSandboxId() : null),
            normalizeKey(firstNonBlank(params, "alertname", "alertName")),
            normalizeKey(reasonCode),
            normalizeKey(firstNonBlank(params, "pod"))
        );
    }

    private SsSandboxResizeRecord findReusableAudit(String idempotencyKey, Date now) {
        if (StringUtils.isBlank(idempotencyKey)) {
            return null;
        }
        SsSandboxResizeRecord existing = resizeRecordMapper.selectLatestByIdempotencyKey(idempotencyKey);
        if (existing == null || !isReusableIdempotentStatus(existing, now)) {
            return null;
        }
        return existing;
    }

    private boolean isReusableIdempotentStatus(SsSandboxResizeRecord record, Date now) {
        if (record == null || StringUtils.isBlank(record.getStatus())) {
            return false;
        }
        if (StringUtils.equalsAnyIgnoreCase(record.getStatus(), STATUS_PROCESSING)) {
            return true;
        }
        if (!StringUtils.equalsAnyIgnoreCase(record.getStatus(),
            STATUS_SUCCESS,
            STATUS_DEFERRED,
            STATUS_RECORDED_OPS_INCIDENT,
            STATUS_SKIPPED_NOOP,
            STATUS_SKIPPED_BOUNDARY,
            STATUS_SKIPPED_INVALID,
            STATUS_SKIPPED_DUPLICATE,
            STATUS_SKIPPED_COOLDOWN,
            STATUS_SKIPPED_STALE)) {
            return false;
        }
        Date reusableAt = record.getFinishedAt() != null ? record.getFinishedAt() : record.getStartedAt();
        if (reusableAt == null || now == null) {
            return false;
        }
        long elapsedMillis = now.getTime() - reusableAt.getTime();
        return elapsedMillis >= 0 && elapsedMillis <= COMPLETED_IDEMPOTENCY_REUSE_WINDOW.toMillis();
    }

    private String normalizeKey(Object value) {
        if (value == null || StringUtils.isBlank(value.toString())) {
            return "-";
        }
        return value.toString().trim().toLowerCase(Locale.ROOT);
    }

    private String resolveNextProfileKey(String serviceType, String currentProfileKey) {
        if (profileEntityMapper == null || StringUtils.isBlank(serviceType)) {
            return null;
        }
        try {
            List<SandboxServiceProfileEntity> profiles = profileEntityMapper.selectEnabledProfiles(serviceType);
            if (profiles == null || profiles.isEmpty()) {
                return null;
            }
            boolean returnNext = StringUtils.isBlank(currentProfileKey);
            for (SandboxServiceProfileEntity profile : profiles) {
                if (profile == null || profile.getResizeEnabled() != null && profile.getResizeEnabled() == 0) {
                    continue;
                }
                String profileKey = profile.getProfileKey();
                if (StringUtils.isBlank(profileKey)) {
                    continue;
                }
                if (returnNext) {
                    return profileKey;
                }
                if (profileKey.equalsIgnoreCase(currentProfileKey)) {
                    returnNext = true;
                }
            }
        }
        catch (Exception e) {
            LOGGER.warn("解析扩容目标规格失败，serviceType={}，currentProfile={}，原因：{}",
                serviceType, currentProfileKey, e.getMessage());
        }
        return null;
    }

    private String resolvePreviousProfileKey(String serviceType, String currentProfileKey) {
        if (profileEntityMapper == null || StringUtils.isBlank(serviceType) || StringUtils.isBlank(currentProfileKey)) {
            return null;
        }
        try {
            List<SandboxServiceProfileEntity> profiles = profileEntityMapper.selectEnabledProfiles(serviceType);
            if (profiles == null || profiles.isEmpty()) {
                return null;
            }
            String previousProfileKey = null;
            for (SandboxServiceProfileEntity profile : profiles) {
                if (profile == null || profile.getResizeEnabled() != null && profile.getResizeEnabled() == 0) {
                    continue;
                }
                String profileKey = profile.getProfileKey();
                if (StringUtils.isBlank(profileKey)) {
                    continue;
                }
                if (profileKey.equalsIgnoreCase(currentProfileKey)) {
                    return previousProfileKey;
                }
                previousProfileKey = profileKey;
            }
        }
        catch (Exception e) {
            LOGGER.warn("解析降配目标规格失败，serviceType={}，currentProfile={}，原因：{}",
                serviceType, currentProfileKey, e.getMessage());
        }
        return null;
    }

    private String resolveScaleDownProfileKey(String serviceType, String currentProfileKey, Map<String, Object> params) {
        String fallbackProfileKey = resolvePreviousProfileKey(serviceType, currentProfileKey);
        SandboxUsage usage = queryCurrentSandboxUsage(params);
        if (usage == null || profileEntityMapper == null || StringUtils.isAnyBlank(serviceType, currentProfileKey)) {
            return fallbackProfileKey;
        }
        try {
            List<SandboxServiceProfileEntity> profiles = profileEntityMapper.selectEnabledProfiles(serviceType);
            if (profiles == null || profiles.isEmpty()) {
                return fallbackProfileKey;
            }
            int currentIndex = -1;
            List<SandboxServiceProfileEntity> enabledProfiles = new java.util.ArrayList<>();
            for (SandboxServiceProfileEntity profile : profiles) {
                if (profile == null || profile.getResizeEnabled() != null && profile.getResizeEnabled() == 0
                    || StringUtils.isBlank(profile.getProfileKey())) {
                    continue;
                }
                if (profile.getProfileKey().equalsIgnoreCase(currentProfileKey)) {
                    currentIndex = enabledProfiles.size();
                }
                enabledProfiles.add(profile);
            }
            if (currentIndex <= 0) {
                return fallbackProfileKey;
            }

            double requiredCpuCores = usage.cpuCores() * Math.max(1D, getTierAutoscaleConfig().getDownscaleCpuHeadroom());
            long requiredMemoryBytes = Math.round(usage.memoryBytes()
                * Math.max(1D, getTierAutoscaleConfig().getDownscaleMemoryHeadroom()));
            String selectedProfileKey = fallbackProfileKey;
            for (int i = 0; i < currentIndex; i++) {
                SandboxServiceProfileEntity profile = enabledProfiles.get(i);
                SandboxServiceSpec spec = specRepository.findByServiceKeyAndProfile(serviceType, profile.getProfileKey())
                    .orElse(null);
                if (spec == null || spec.getResourceRequests() == null) {
                    continue;
                }
                double requestCpuCores = parseCpuCores(spec.getResourceRequests().get("cpu"));
                long requestMemoryBytes = parseMemoryBytes(spec.getResourceRequests().get("memory"));
                if (requestCpuCores >= requiredCpuCores && requestMemoryBytes >= requiredMemoryBytes) {
                    selectedProfileKey = StringUtils.defaultIfBlank(spec.getProfileKey(), profile.getProfileKey());
                    break;
                }
            }
            LOGGER.info("沙箱低水位目标规格解析完成，serviceType={}，currentProfile={}，fallbackProfile={}，targetProfile={}，cpuCores={}，memoryBytes={}",
                serviceType, currentProfileKey, fallbackProfileKey, selectedProfileKey, usage.cpuCores(),
                usage.memoryBytes());
            return selectedProfileKey;
        }
        catch (Exception e) {
            LOGGER.warn("解析降配目标规格失败，serviceType={}，currentProfile={}，原因：{}",
                serviceType, currentProfileKey, e.getMessage());
            return fallbackProfileKey;
        }
    }

    private SandboxUsage queryCurrentSandboxUsage(Map<String, Object> params) {
        SandboxProperties.TierAutoscaleConfig config = getTierAutoscaleConfig();
        String prometheusBaseUrl = config.getPrometheusBaseUrl();
        String namespace = firstNonBlank(params, "namespace");
        String pod = firstNonBlank(params, "pod");
        if (StringUtils.isAnyBlank(prometheusBaseUrl, namespace, pod)) {
            return null;
        }
        try {
            String window = toPrometheusDuration(config.getPrometheusQueryWindow(), "5m");
            String cpuQuery = String.format(Locale.ROOT,
                "sum(rate(container_cpu_usage_seconds_total{namespace=\"%s\",container=\"sandbox\",pod=\"%s\"}[%s]))",
                escapePrometheusLabelValue(namespace), escapePrometheusLabelValue(pod), window);
            String memoryQuery = String.format(Locale.ROOT,
                "sum(container_memory_working_set_bytes{namespace=\"%s\",container=\"sandbox\",pod=\"%s\"})",
                escapePrometheusLabelValue(namespace), escapePrometheusLabelValue(pod));
            Double cpuCores = queryPrometheusScalar(prometheusBaseUrl, cpuQuery);
            Double memoryBytes = queryPrometheusScalar(prometheusBaseUrl, memoryQuery);
            if (cpuCores == null || memoryBytes == null) {
                return null;
            }
            return new SandboxUsage(cpuCores, Math.max(0L, memoryBytes.longValue()));
        }
        catch (RuntimeException e) {
            LOGGER.warn("查询沙箱 Prometheus 用量失败，namespace={}，pod={}，原因={}", namespace, pod, e.getMessage());
            return null;
        }
    }

    private Double queryPrometheusScalar(String prometheusBaseUrl, String query) {
        try {
            String url = resolvePrometheusQueryUrl(prometheusBaseUrl) + "?query="
                + URLEncoder.encode(query, StandardCharsets.UTF_8);
            HttpRequest request = HttpRequest.newBuilder(URI.create(url)).GET().build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                LOGGER.warn("Prometheus 查询失败，status={}，query={}", response.statusCode(), query);
                return null;
            }
            JsonNode root = objectMapper.readTree(response.body());
            JsonNode result = root.path("data").path("result");
            if (!result.isArray() || result.isEmpty()) {
                return null;
            }
            JsonNode value = result.get(0).path("value");
            if (!value.isArray() || value.size() < 2) {
                return null;
            }
            return value.get(1).asDouble();
        }
        catch (IOException e) {
            LOGGER.warn("Prometheus 查询 IO 异常，query={}，原因={}", query, e.getMessage());
            return null;
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            LOGGER.warn("Prometheus 查询被中断，query={}", query);
            return null;
        }
    }

    private String resolvePrometheusQueryUrl(String baseUrl) {
        String normalized = StringUtils.removeEnd(StringUtils.trim(baseUrl), "/");
        if (StringUtils.endsWith(normalized, "/api/v1/query")) {
            return normalized;
        }
        return normalized + "/api/v1/query";
    }

    private String toPrometheusDuration(Duration duration, String fallback) {
        long seconds = duration == null || duration.isNegative() || duration.isZero()
            ? 0L
            : duration.toSeconds();
        if (seconds <= 0L) {
            return fallback;
        }
        if (seconds % 3600L == 0L) {
            return (seconds / 3600L) + "h";
        }
        if (seconds % 60L == 0L) {
            return (seconds / 60L) + "m";
        }
        return seconds + "s";
    }

    private String escapePrometheusLabelValue(String value) {
        return StringUtils.defaultString(value)
            .replace("\\", "\\\\")
            .replace("\"", "\\\"");
    }

    private String escapePrometheusMetricLabel(String value) {
        return escapePrometheusLabelValue(value).replace("\n", "\\n");
    }

    private double parseCpuCores(String value) {
        if (StringUtils.isBlank(value)) {
            return 0D;
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        try {
            if (normalized.endsWith("m")) {
                return Double.parseDouble(StringUtils.removeEnd(normalized, "m")) / 1000D;
            }
            return Double.parseDouble(normalized);
        }
        catch (NumberFormatException e) {
            return 0D;
        }
    }

    private long parseMemoryBytes(String value) {
        if (StringUtils.isBlank(value)) {
            return 0L;
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        try {
            if (normalized.endsWith("ki")) {
                return Math.round(Double.parseDouble(StringUtils.removeEnd(normalized, "ki")) * 1024D);
            }
            if (normalized.endsWith("mi")) {
                return Math.round(Double.parseDouble(StringUtils.removeEnd(normalized, "mi")) * 1024D * 1024D);
            }
            if (normalized.endsWith("gi")) {
                return Math.round(Double.parseDouble(StringUtils.removeEnd(normalized, "gi")) * 1024D * 1024D * 1024D);
            }
            if (normalized.endsWith("k")) {
                return Math.round(Double.parseDouble(StringUtils.removeEnd(normalized, "k")) * 1000D);
            }
            if (normalized.endsWith("m")) {
                return Math.round(Double.parseDouble(StringUtils.removeEnd(normalized, "m")) * 1000D * 1000D);
            }
            if (normalized.endsWith("g")) {
                return Math.round(Double.parseDouble(StringUtils.removeEnd(normalized, "g")) * 1000D * 1000D * 1000D);
            }
            return Math.round(Double.parseDouble(normalized));
        }
        catch (NumberFormatException e) {
            return 0L;
        }
    }

    private record SandboxUsage(double cpuCores, long memoryBytes) {
    }

    private record ProfileBoundary(String minProfileKey, String maxProfileKey) {
        private boolean isValid() {
            return StringUtils.isNoneBlank(minProfileKey, maxProfileKey);
        }
    }

    private String normalizeSandboxId(String value) {
        if (StringUtils.isBlank(value)) {
            return value;
        }
        String trimmed = value.trim();
        return trimmed.replaceFirst("^([0-9a-fA-F-]{36})-\\d+$", "$1");
    }

    private SsSandboxResizeRecord buildRequestedAudit(SsSandboxRecord record,
                                                      String serviceType,
                                                      String toProfileKey,
                                                      String triggerSource,
                                                      String reasonCode,
                                                      String reasonDetail,
                                                      String resizeType,
                                                      SandboxServiceSpec targetSpec,
                                                      Date startedAt) {
        SsSandboxResizeRecord audit = new SsSandboxResizeRecord();
        audit.setSandboxRecordId(record.getId());
        audit.setSandboxId(record.getSandboxId());
        audit.setUserCode(record.getUserCode());
        audit.setServiceType(serviceType);
        audit.setFromProfileKey(record.getProfileKey());
        audit.setToProfileKey(toProfileKey);
        audit.setFromResourceRequests(record.getResourceRequests());
        audit.setFromResourceLimits(record.getResourceLimits());
        audit.setToResourceRequests(toJsonOrNull(targetSpec != null ? targetSpec.getResourceRequests() : null));
        audit.setToResourceLimits(toJsonOrNull(targetSpec != null ? targetSpec.getResourceLimits() : null));
        audit.setTriggerSource(triggerSource);
        audit.setReasonCode(reasonCode);
        audit.setReasonDetail(reasonDetail);
        audit.setResizeType(resizeType);
        audit.setStatus(STATUS_REQUESTED);
        audit.setStartedAt(startedAt);
        audit.setCreateTime(startedAt);
        audit.setUpdateTime(startedAt);
        return audit;
    }

    private SsSandboxResizeRecord buildSkippedAudit(SsSandboxRecord record,
                                                    String serviceType,
                                                    String toProfileKey,
                                                    String triggerSource,
                                                    String reasonCode,
                                                    String reasonDetail,
                                                    String resizeType,
                                                    SandboxServiceSpec targetSpec,
                                                    Date startedAt,
                                                    String idempotencyKey,
                                                    String status,
                                                    String message,
                                                    int success) {
        SsSandboxResizeRecord audit = buildRequestedAudit(record, serviceType, toProfileKey, triggerSource,
            reasonCode, reasonDetail, resizeType, targetSpec, startedAt);
        Date finishedAt = new Date();
        audit.setIdempotencyKey(idempotencyKey);
        audit.setStatus(status);
        audit.setSuccess(success);
        audit.setFinishedAt(finishedAt);
        audit.setDurationMs(Math.max(0L, finishedAt.getTime() - startedAt.getTime()));
        audit.setErrorMessage(message);
        audit.setSkipReason(message);
        audit.setUpdateTime(finishedAt);
        LOGGER.info("沙箱扩缩容跳过，recordId={}，sandboxId={}，fromProfile={}，toProfile={}，status={}，原因：{}",
            record.getId(), record.getSandboxId(), record.getProfileKey(), toProfileKey, status, message);
        return audit;
    }

    private SsSandboxResizeRecord buildPayloadSkippedAudit(String message) {
        Date now = new Date();
        SsSandboxResizeRecord audit = new SsSandboxResizeRecord();
        audit.setTriggerSource("PROMETHEUS_ALERT");
        audit.setReasonCode("prometheus.alert");
        audit.setReasonDetail(message);
        audit.setStatus(STATUS_SKIPPED_INVALID);
        audit.setSuccess(1);
        audit.setStartedAt(now);
        audit.setFinishedAt(now);
        audit.setDurationMs(0L);
        audit.setErrorMessage(message);
        audit.setSkipReason(message);
        audit.setCreateTime(now);
        audit.setUpdateTime(now);
        return audit;
    }

    private boolean isResolvedAlert(Map<?, ?> alert) {
        if (alert == null) {
            return false;
        }
        Object status = alert.get("status");
        return status != null && "resolved".equalsIgnoreCase(status.toString());
    }

    private void finishDeferred(SsSandboxResizeRecord audit, String message, int success) {
        Date finishedAt = new Date();
        long durationMs = Math.max(0L, finishedAt.getTime() - audit.getStartedAt().getTime());
        resizeRecordMapper.updateResult(audit.getId(), STATUS_DEFERRED, success, finishedAt, durationMs,
            null, null, message);
        audit.setStatus(STATUS_DEFERRED);
        audit.setSuccess(success);
        audit.setFinishedAt(finishedAt);
        audit.setDurationMs(durationMs);
        audit.setErrorMessage(message);
    }

    private Map<String, String> buildResizeMetadata(SsSandboxRecord record,
                                                    SsSandboxResizeRecord audit,
                                                    String toProfileKey,
                                                    String reasonCode) {
        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("recordId", String.valueOf(record.getId()));
        metadata.put("resizeRecordId", String.valueOf(audit.getId()));
        metadata.put("userCode", record.getUserCode());
        metadata.put("serviceType", StringUtils.defaultIfBlank(record.getServiceType(), record.getSandboxType()));
        metadata.put("fromProfileKey", StringUtils.defaultString(record.getProfileKey()));
        metadata.put("toProfileKey", toProfileKey);
        metadata.put("reasonCode", reasonCode);
        return metadata;
    }

    private void copyNestedMap(Map<String, Object> target, Map<String, Object> source) {
        if (target == null || source == null || source.isEmpty()) {
            return;
        }
        source.forEach((key, value) -> {
            if (key != null && value != null) {
                target.putIfAbsent(key, value);
            }
        });
    }

    private String firstNonBlank(Map<String, Object> params, String... keys) {
        if (params == null || keys == null) {
            return null;
        }
        for (String key : keys) {
            Object value = params.get(key);
            if (value != null && StringUtils.isNotBlank(value.toString())) {
                return value.toString().trim();
            }
        }
        return null;
    }

    private Long parseLong(Object value) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        if (value == null || StringUtils.isBlank(value.toString())) {
            return null;
        }
        try {
            return Long.parseLong(value.toString().trim());
        }
        catch (NumberFormatException e) {
            return null;
        }
    }

    private String toJsonOrNull(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(value);
        }
        catch (JsonProcessingException e) {
            return null;
        }
    }
}
