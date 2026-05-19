package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.iwhalecloud.byai.common.feign.client.FeignWhaleAgentService;
import com.iwhalecloud.byai.common.feign.interceptor.WhaleAgentUserContextHolder;
import com.iwhalecloud.byai.common.feign.request.sandbox.RenewSandboxTimeoutRequest;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxCreateResult;
import com.iwhalecloud.byai.common.feign.response.sandbox.WhaleAgentSandboxPageResult;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxDetail;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

public class WhaleAgentSandboxRuntimeProvider implements SandboxRuntimeProvider {

    private static final String WHALE_AGENT_SANDBOX_TYPE = "byclaw";
    private static final Logger log = LoggerFactory.getLogger(WhaleAgentSandboxRuntimeProvider.class);

    private final FeignWhaleAgentService feignWhaleAgentService;

    public WhaleAgentSandboxRuntimeProvider(FeignWhaleAgentService feignWhaleAgentService) {
        this.feignWhaleAgentService = feignWhaleAgentService;
    }

    @Override
    public String providerType() {
        return "whale-agent";
    }

    @Override
    public Optional<SandboxRuntimeInstance> findReusable(String userCode, String sandboxType) {
        if (StringUtils.isBlank(userCode) || StringUtils.isBlank(sandboxType)) {
            return Optional.empty();
        }
        try {
            log.info("WhaleAgent 查询可复用沙箱，userCode={}，sandboxType={}", userCode, sandboxType);
            KnowledgeResponse<WhaleAgentSandboxPageResult> response = withUserCode(userCode, () -> feignWhaleAgentService.listSandboxes(
                SandboxRuntimeRequestFactory.buildWhaleAgentListSandboxesRequest(userCode, sandboxType)));
            validateOperationResponse(response, "WhaleAgent sandbox list failed");
            WhaleAgentSandboxPageResult pageResult = response.getResultObject();
            if (pageResult == null || pageResult.getItems() == null || pageResult.getItems().isEmpty()) {
                log.info("WhaleAgent 未找到可复用沙箱，userCode={}，sandboxType={}", userCode, sandboxType);
                return Optional.empty();
            }
            Optional<SandboxRuntimeInstance> reusable = pageResult.getItems().stream()
                .filter(detail -> detail != null && StringUtils.isNotBlank(detail.getId()))
                .filter(detail -> SandboxRuntimeRequestFactory.isReusableSandboxState(detail.getStatus()))
                .sorted(this::compareSandboxReusePreference)
                .map(detail -> SandboxRuntimeInstance.builder()
                    .sandboxId(detail.getId())
                    .createdAt(detail.getCreatedAt())
                    .expiresAt(detail.getExpiresAt())
                    .build())
                .findFirst();
            log.info("WhaleAgent 可复用沙箱查询完成，userCode={}，sandboxType={}，selectedSandboxId={}",
                userCode, sandboxType, reusable.map(SandboxRuntimeInstance::getSandboxId).orElse(null));
            return reusable;
        }
        catch (Exception e) {
            log.info("WhaleAgent listSandboxes failed (will create new if needed), userCode={}, sandboxType={}, cause={}",
                userCode, sandboxType, e.getMessage());
            return Optional.empty();
        }
    }

    @Override
    public SandboxRuntimeInstance create(CreateSandboxRequest request,
                                         SandboxServiceSpec spec,
                                         String userCode,
                                         String sandboxType,
                                         String idempotencyKey) {
        log.info("WhaleAgent 创建沙箱，userCode={}，sandboxType={}，idempotencyKey={}", userCode, sandboxType, idempotencyKey);
        SandboxRuntimeRequestFactory.applyIdempotencyMetadata(request, idempotencyKey);
        Map<String, Object> payload = SandboxRuntimeRequestFactory.buildWhaleAgentLaunchPayload(
            request, spec, WHALE_AGENT_SANDBOX_TYPE);
        KnowledgeResponse<SandboxCreateResult> response = withUserCode(userCode, () -> feignWhaleAgentService.launchSandbox(payload));
        validateLaunchResponse(response);
        SandboxCreateResult result = response.getResultObject();
        String sandboxId = result != null ? result.getSandboxId() : null;
        String endpoint = result != null ? result.getEndpoint() : null;
        log.info("WhaleAgent 创建沙箱成功，userCode={}，sandboxType={}，sandboxId={}，endpoint={}",
            userCode, sandboxType, sandboxId, endpoint);
        List<String> endpoints = StringUtils.isNotBlank(endpoint) ? List.of(endpoint) : List.of();
        return SandboxRuntimeInstance.builder()
            .sandboxId(StringUtils.defaultIfBlank(sandboxId, userCode + ":" + sandboxType))
            .endpoints(endpoints)
            .build();
    }

    @Override
    public void remove(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (sandboxInfo == null || StringUtils.isBlank(sandboxInfo.getSandboxId())) {
            return;
        }
        log.info("WhaleAgent 删除沙箱，userCode={}，sandboxType={}，sandboxId={}",
            userCode, sandboxType, sandboxInfo.getSandboxId());
        withUserCode(userCode, () -> feignWhaleAgentService.destroySandbox(
            SandboxRuntimeRequestFactory.buildSandboxIdRequest(sandboxInfo.getSandboxId())));
    }

    @Override
    public void heartbeat(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (sandboxInfo == null
            || StringUtils.isBlank(sandboxInfo.getSandboxId())
            || sandboxInfo.getTimeoutSeconds() == null
            || sandboxInfo.getTimeoutSeconds() <= 0) {
            log.debug("WhaleAgent 跳过续约，参数不足，userCode={}，sandboxType={}，sandboxId={}，timeoutSeconds={}",
                userCode, sandboxType, sandboxInfo != null ? sandboxInfo.getSandboxId() : null,
                sandboxInfo != null ? sandboxInfo.getTimeoutSeconds() : null);
            return;
        }
        RenewSandboxTimeoutRequest request = SandboxRuntimeRequestFactory.buildWhaleAgentRenewRequest(sandboxInfo);
        log.info("WhaleAgent 续约沙箱，userCode={}，sandboxType={}，sandboxId={}，duration={}",
            userCode, sandboxType, sandboxInfo.getSandboxId(), request.getDuration());
        KnowledgeResponse<?> response = withUserCode(userCode, () -> feignWhaleAgentService.renewSandboxTimeout(request));
        validateOperationResponse(response, "WhaleAgent sandbox heartbeat failed");
        log.info("WhaleAgent 续约沙箱成功，userCode={}，sandboxType={}，sandboxId={}",
            userCode, sandboxType, sandboxInfo.getSandboxId());
    }

    @Override
    public boolean exists(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (sandboxInfo == null || StringUtils.isBlank(sandboxInfo.getSandboxId())) {
            return false;
        }
        KnowledgeResponse<SandboxDetail> response = withUserCode(userCode, () -> feignWhaleAgentService.getSandboxInfo(
            SandboxRuntimeRequestFactory.buildSandboxIdRequest(sandboxInfo.getSandboxId())));
        validateOperationResponse(response, "WhaleAgent sandbox query failed");
        SandboxDetail detail = response.getResultObject();
        boolean exists = detail != null && SandboxRuntimeRequestFactory.isReusableSandboxState(detail.getStatus());
        log.info("WhaleAgent 查询远端状态，userCode={}，sandboxType={}，sandboxId={}，exists={}，remoteState={}",
            userCode, sandboxType, sandboxInfo.getSandboxId(), exists,
            detail != null && detail.getStatus() != null ? detail.getStatus().getState() : null);
        return exists;
    }

    private void validateLaunchResponse(KnowledgeResponse<SandboxCreateResult> response) {
        validateOperationResponse(response, "WhaleAgent sandbox launch failed");
        if (response.getResultObject() == null) {
            throw new IllegalStateException("WhaleAgent sandbox resultObject is empty");
        }
    }

    private void validateOperationResponse(KnowledgeResponse<?> response, String defaultMessage) {
        if (response == null) {
            throw new IllegalStateException("WhaleAgent sandbox response is empty");
        }
        if (!KnowledgeResponse.RESPONSE_SUCCESS.equals(response.getResultCode())) {
            throw new IllegalStateException(StringUtils.defaultIfBlank(response.getResultMsg(),
                defaultMessage));
        }
    }

    private int compareSandboxReusePreference(SandboxDetail a, SandboxDetail b) {
        int rankA = SandboxRuntimeRequestFactory.stateRankForReuse(a.getStatus());
        int rankB = SandboxRuntimeRequestFactory.stateRankForReuse(b.getStatus());
        if (rankA != rankB) {
            return Integer.compare(rankB, rankA);
        }
        if (a.getCreatedAt() == null && b.getCreatedAt() == null) {
            return 0;
        }
        if (a.getCreatedAt() == null) {
            return 1;
        }
        if (b.getCreatedAt() == null) {
            return -1;
        }
        return b.getCreatedAt().compareTo(a.getCreatedAt());
    }

    private <T> T withUserCode(String userCode, java.util.function.Supplier<T> supplier) {
        String previousUserCode = WhaleAgentUserContextHolder.getUserCode();
        if (StringUtils.isNotBlank(userCode)) {
            WhaleAgentUserContextHolder.setUserCode(userCode);
        }
        try {
            return supplier.get();
        }
        finally {
            if (StringUtils.isNotBlank(previousUserCode)) {
                WhaleAgentUserContextHolder.setUserCode(previousUserCode);
            }
            else {
                WhaleAgentUserContextHolder.clear();
            }
        }
    }

}
