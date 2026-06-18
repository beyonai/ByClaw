package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
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
    private static final String DEFAULT_TRIGGER_SOURCE = "MANUAL";
    private static final String DEFAULT_RESIZE_TYPE = "IN_PLACE";

    private final SandboxProperties sandboxProperties;
    private final OpenSandboxClient openSandboxClient;
    private final SandboxServiceSpecRepository specRepository;
    private final SandboxServiceProfileEntityMapper profileEntityMapper;
    private final SsSandboxRecordMapper sandboxRecordMapper;
    private final SsSandboxResizeRecordMapper resizeRecordMapper;
    private final SandboxService sandboxService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SandboxResizeService(SandboxProperties sandboxProperties,
                                OpenSandboxClient openSandboxClient,
                                SandboxServiceSpecRepository specRepository,
                                SandboxServiceProfileEntityMapper profileEntityMapper,
                                @Lazy SsSandboxRecordMapper sandboxRecordMapper,
                                SsSandboxResizeRecordMapper resizeRecordMapper,
                                @Lazy SandboxService sandboxService) {
        this.sandboxProperties = sandboxProperties;
        this.openSandboxClient = openSandboxClient;
        this.specRepository = specRepository;
        this.profileEntityMapper = profileEntityMapper;
        this.sandboxRecordMapper = sandboxRecordMapper;
        this.resizeRecordMapper = resizeRecordMapper;
        this.sandboxService = sandboxService;
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
        if (StringUtils.isBlank(toProfileKey) && isScaleUpAlert(reasonCode)) {
            toProfileKey = resolveNextProfileKey(serviceType, record.getProfileKey());
        }

        SandboxServiceSpec targetSpec = null;
        if (StringUtils.isNotBlank(toProfileKey)) {
            targetSpec = specRepository.findByServiceKeyAndProfile(serviceType, toProfileKey).orElse(null);
        }

        Date startedAt = new Date();
        SsSandboxResizeRecord audit = buildRequestedAudit(record, serviceType, toProfileKey, triggerSource,
            reasonCode, reasonDetail, resizeType, targetSpec, startedAt);
        resizeRecordMapper.insert(audit);

        if (StringUtils.isBlank(toProfileKey) || targetSpec == null) {
            String message = StringUtils.isBlank(toProfileKey)
                ? "target profile key is required"
                : "target profile is not enabled or not found";
            finishDeferred(record, audit, message, 0);
            return audit;
        }
        if ("PREFERRED_ONLY".equalsIgnoreCase(resizeType)) {
            sandboxService.savePreferredServiceKey(record.getUserCode(), serviceType + "-" + toProfileKey);
            finishDeferred(record, audit, "preferred profile will apply on next sandbox start", 1);
            return audit;
        }

        long startMillis = System.currentTimeMillis();
        try {
            ResizeSandboxRequest request = ResizeSandboxRequest.builder()
                .resourceRequests(targetSpec.getResourceRequests())
                .resourceLimits(targetSpec.getResourceLimits())
                .resizeType(resizeType)
                .metadata(buildResizeMetadata(record, audit, toProfileKey, reasonCode))
                .build();
            ResizeSandboxResponse response = openSandboxClient.resizeSandbox(record.getSandboxId(), request);
            Date finishedAt = new Date();
            long durationMs = System.currentTimeMillis() - startMillis;
            String responseJson = toJsonOrNull(response);
            String requestId = response != null
                ? StringUtils.defaultIfBlank(response.getRequestId(), response.getOperationId())
                : null;
            resizeRecordMapper.updateResult(audit.getId(), STATUS_SUCCESS, 1, finishedAt, durationMs,
                requestId, responseJson, null);
            audit.setStatus(STATUS_SUCCESS);
            audit.setSuccess(1);
            audit.setFinishedAt(finishedAt);
            audit.setDurationMs(durationMs);
            audit.setOpensandboxRequestId(requestId);
            audit.setOpensandboxResponse(responseJson);

            String newSandboxId = response != null && StringUtils.isNotBlank(response.getSandboxId())
                ? response.getSandboxId()
                : null;
            String resolvedToProfileKey = StringUtils.defaultIfBlank(targetSpec.getProfileKey(), toProfileKey);
            sandboxRecordMapper.updateResizeSuccess(record.getId(), newSandboxId, null, null,
                resolvedToProfileKey, toJsonOrNull(targetSpec.getResourceRequests()),
                toJsonOrNull(targetSpec.getResourceLimits()), STATUS_SUCCESS, finishedAt, reasonDetail,
                durationMs, 1, record.getProfileKey(), resolvedToProfileKey, null,
                record.getLockVersion());
            LOGGER.info("沙箱扩缩容成功，recordId={}，sandboxId={}，fromProfile={}，toProfile={}，durationMs={}",
                record.getId(), record.getSandboxId(), record.getProfileKey(), resolvedToProfileKey, durationMs);
            return audit;
        }
        catch (Exception e) {
            Date finishedAt = new Date();
            long durationMs = System.currentTimeMillis() - startMillis;
            resizeRecordMapper.updateResult(audit.getId(), STATUS_FAILED, 0, finishedAt, durationMs,
                null, null, e.getMessage());
            sandboxRecordMapper.updateResizeSummary(record.getId(), STATUS_FAILED, finishedAt, reasonDetail,
                durationMs, 0, record.getProfileKey(), toProfileKey, e.getMessage(), record.getLockVersion());
            audit.setStatus(STATUS_FAILED);
            audit.setSuccess(0);
            audit.setFinishedAt(finishedAt);
            audit.setDurationMs(durationMs);
            audit.setErrorMessage(e.getMessage());
            LOGGER.warn("沙箱扩缩容失败，recordId={}，sandboxId={}，toProfile={}，原因：{}",
                record.getId(), record.getSandboxId(), toProfileKey, e.getMessage());
            return audit;
        }
    }

    @SuppressWarnings("unchecked")
    public SsSandboxResizeRecord handlePrometheusAlert(Map<String, Object> payload) {
        Map<String, Object> params = new LinkedHashMap<>();
        if (payload == null) {
            params.put("triggerSource", "PROMETHEUS_ALERT");
            params.put("reasonCode", "prometheus.alert");
            params.put("reasonDetail", toJsonOrNull(payload));
            return handleResizeRequest(params);
        }
        Object alertsObj = payload.get("alerts");
        if (alertsObj instanceof Iterable<?> alerts) {
            for (Object item : alerts) {
                if (item instanceof Map<?, ?> alert) {
                    copyNestedMap(params, (Map<String, Object>) alert.get("labels"));
                    copyNestedMap(params, (Map<String, Object>) alert.get("annotations"));
                    break;
                }
            }
        }
        copyNestedMap(params, (Map<String, Object>) payload.get("labels"));
        copyNestedMap(params, (Map<String, Object>) payload.get("annotations"));
        params.putIfAbsent("triggerSource", "PROMETHEUS_ALERT");
        params.putIfAbsent("reasonCode", "prometheus.alert");
        params.putIfAbsent("reasonDetail", toJsonOrNull(payload));
        return handleResizeRequest(params);
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

    private void finishDeferred(SsSandboxRecord record, SsSandboxResizeRecord audit, String message, int success) {
        Date finishedAt = new Date();
        long durationMs = Math.max(0L, finishedAt.getTime() - audit.getStartedAt().getTime());
        resizeRecordMapper.updateResult(audit.getId(), STATUS_DEFERRED, success, finishedAt, durationMs,
            null, null, message);
        sandboxRecordMapper.updateResizeSummary(record.getId(), STATUS_DEFERRED, finishedAt,
            audit.getReasonDetail(), durationMs, success, record.getProfileKey(), audit.getToProfileKey(),
            message, record.getLockVersion());
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
