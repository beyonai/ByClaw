package com.iwhalecloud.byai.gateway.sandbox.shared;

import java.util.*;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserInfoFactory;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

/** 共享数据只经平台 API；本层不查询或修改共享表。 */
@Service
public class SharedSandboxGateway {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(SharedSandboxGateway.class);
    public static final String DSH_SERVICE = "byclaw-dsh";
    private final ObjectProvider<SharedSandboxPlatformClient> clients;
    private final SharedSandboxPolicy policy;
    private final SandboxUserInfoFactory users;
    private final ObjectMapper json;
    // Discovery only: the platform remains authoritative. Bound memory across long-lived BE nodes.
    private final Map<String, Boolean> observedSharedUsers = Collections.synchronizedMap(
        new LinkedHashMap<>(128, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                return size() > 10_000;
            }
        });

    public SharedSandboxGateway(ObjectProvider<SharedSandboxPlatformClient> clients, SharedSandboxPolicy policy,
        SandboxUserInfoFactory users, ObjectMapper json) {
        this.clients = clients;
        this.policy = policy;
        this.users = users;
        this.json = json.copy().disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }

    public SandboxLaunchData tryAcquire(String user, String type) {
        if (StringUtils.isBlank(type) || StringUtils.isBlank(user)) return null;
        // Recheck every request before discovering or reusing a mapping, including historical Resume targets.
        boolean eligible = policy.eligible(user);
        log.debug("Shared sandbox allocation eligibility, userCode={}, serviceKey={}, eligible={}", user, type, eligible);
        if (!eligible) {
            releaseAll(user, "eligibility.revoked");
            return null;
        }
        if (clients.getIfAvailable() == null) {
            throw new BdpRuntimeException("共享沙箱需要配置 byclaw.platform.base-url");
        }
        Map<String, Object> identity = identity(user, type);
        Object existing = call("lookup", identity);
        if (existing != null) {
            observedSharedUsers.put(user, true);
            return json.convertValue(existing, SandboxLaunchData.class);
        }
        if (policy.userNasEnabled(user, type)) requireUserStorage(identity);
        identity.put("byTenant", policy.byTenant());
        identity.put("replaceExclusive", true);
        Object allocated = call("acquire", identity);
        if (allocated != null) observedSharedUsers.put(user, true);
        return allocated == null ? null : json.convertValue(allocated, SandboxLaunchData.class);
    }

    private void requireUserStorage(Map<String, Object> identity) {
        Object result = call("prepareUserStorage", identity);
        if (!(result instanceof Map<?, ?> status) || !Boolean.TRUE.equals(status.get("enabled"))) {
            throw storageFailure("SHARED_USER_NAS_POLICY_NOT_APPLIED");
        }
        if (!Boolean.TRUE.equals(status.get("ready"))) {
            throw storageFailure("SHARED_USER_NAS_" + Objects.toString(status.get("state"), "PREPARING_STORAGE"));
        }
    }

    /** Return only user-facing preparation state; never expose NAS bindings or other users. */
    public Map<String, Object> userStorageStatus(String user) {
        if (!policy.userNasEnabled(user, DSH_SERVICE)) return Map.of("enabled", false, "ready", true, "state", "LOGICAL");
        Object result = call("userStorageStatus", identity(user, DSH_SERVICE));
        if (!(result instanceof Map<?, ?> status)) throw storageFailure("SHARED_USER_NAS_INVALID_RESPONSE");
        if (!Boolean.TRUE.equals(status.get("enabled"))) {
            return Map.of("enabled", true, "ready", false, "state", "FAILED");
        }
        Map<String, Object> safe = new LinkedHashMap<>();
        for (String key : List.of("enabled", "ready", "state", "quotaGiB", "confirmedGiB", "usedBytes", "quotaSubmittedAt")) {
            if (status.containsKey(key)) safe.put(key, status.get(key));
        }
        return safe;
    }

    public String currentWorkerTarget(String user) {
        // A live exclusive worker must not bypass a newly enabled shared policy.
        SandboxLaunchData data = tryAcquire(user, DSH_SERVICE);
        return data == null ? null : data.getWorkerAgentType();
    }

    private SandboxLaunchData lookup(String user, String service) {
        if (clients.getIfAvailable() == null || StringUtils.isBlank(user)) return null;
        if (!policy.eligible(user)) {
            releaseAll(user, "eligibility.revoked");
            return null;
        }
        Object value = call("lookup", identity(user, service));
        if (value != null) observedSharedUsers.put(user, true);
        return value == null ? null : json.convertValue(value, SandboxLaunchData.class);
    }

    public SandboxInfo info(String user, String service) {
        SandboxLaunchData data = lookup(user, service);
        return data == null ? null : toInfo(user, data);
    }

    public List<SandboxInfo> infos(String user) {
        if (clients.getIfAvailable() == null || StringUtils.isBlank(user)) return Collections.emptyList();
        Object value = call("lookupAll", identity(user, null));
        if (!(value instanceof List<?> list)) throw new BdpRuntimeException("共享映射响应格式错误");
        if (list.isEmpty()) observedSharedUsers.remove(user);
        else observedSharedUsers.put(user, true);
        return list.stream().map(row -> toInfo(user, json.convertValue(row, SandboxLaunchData.class))).toList();
    }

    private SandboxInfo toInfo(String user, SandboxLaunchData data) {
        return SandboxInfo.builder().userCode(user)
            .sandboxType(StringUtils.defaultIfBlank(data.getRequestedServiceKey(), data.getServiceKey()))
            .isShared(data.getIsShared()).mappingId(data.getMappingId()).serviceKey(data.getServiceKey())
            .workerAgentType(data.getWorkerAgentType())
            .sandboxId(data.getSandboxId()).endpoints(data.getEndpoints()).instanceEndpoints(data.getInstanceEndpoints())
            .gatewayToken(data.getGatewayToken()).servicePort(data.getServicePort())
            .endpointHeaders(data.getEndpointHeaders()).build();
    }

    public boolean heartbeat(String user) {
        if (clients.getIfAvailable() == null || StringUtils.isBlank(user)) return false;
        if (!shouldHeartbeatShared(user)) return false;
        Object value = call("heartbeatAll", identity(user, null));
        if (!(value instanceof List<?> list)) throw new BdpRuntimeException("共享心跳响应格式错误");
        return !list.isEmpty();
    }

    public boolean heartbeat(String user, String service) {
        if (clients.getIfAvailable() == null || StringUtils.isBlank(user)) return false;
        if (!shouldHeartbeatShared(user)) return false;
        Object value = call("heartbeat", identity(user, service));
        if (value != null && !(value instanceof Map)) throw new BdpRuntimeException("共享心跳响应格式错误");
        return value != null;
    }

    private boolean shouldHeartbeatShared(String user) {
        boolean observed = Boolean.TRUE.equals(observedSharedUsers.get(user));
        boolean eligible;
        try {
            eligible = policy.eligible(user);
        }
        catch (RuntimeException unavailable) {
            if (observed) throw unavailable;
            // Unrelated users can keep their existing exclusive heartbeat during a policy outage.
            return false;
        }
        if (eligible) return true;
        if (observed) releaseAll(user, "eligibility.revoked");
        return false;
    }

    public boolean release(String user) {
        return releaseAll(user, "manual");
    }

    private boolean releaseAll(String user, String reason) {
        if (clients.getIfAvailable() == null || StringUtils.isBlank(user)) return false;
        Map<String, Object> params = identity(user, null);
        params.put("reason", reason);
        // The platform confirms fenced deletion and releases ownership atomically. A busy
        // context or uncertain response must throw here, before callers enter exclusive launch.
        Object count = call("releaseAll", params);
        if (!(count instanceof Number) || ((Number) count).longValue() < 0)
            throw new BdpRuntimeException("共享释放响应格式错误");
        observedSharedUsers.remove(user);
        return ((Number) count).intValue() > 0;
    }

    public boolean release(String user, String service) {
        return clients.getIfAvailable() != null && StringUtils.isNotBlank(user)
            && Boolean.TRUE.equals(call("releaseMember", identity(user, service)));
    }

    public boolean enabled() {
        if (clients.getIfAvailable() == null) return false;
        Object value = call("listConfigs", Collections.emptyMap());
        if (!(value instanceof List<?> configs)) throw new BdpRuntimeException("共享配置响应格式错误");
        return configs.stream().filter(Map.class::isInstance).map(Map.class::cast)
            .anyMatch(row -> DSH_SERVICE.equals(row.get("sourceServiceKey"))
                && (Boolean.TRUE.equals(row.get("enabled")) || "1".equals(String.valueOf(row.get("enabled")))));
    }

    public Object call(String operation, Map<String, Object> params) {
        SharedSandboxPlatformClient client = clients.getIfAvailable();
        if (client == null) throw new BdpRuntimeException("共享沙箱平台未配置");
        Map<String, Object> result;
        try {
            result = client.call(operation, params);
        }
        catch (feign.FeignException failure) {
            throw new BdpRuntimeException("共享沙箱平台请求失败，HTTP " + failure.status());
        }
        if (result == null || !(result.get("code") instanceof Number code)) {
            throw new BdpRuntimeException("共享沙箱平台响应格式错误");
        }
        if (code.intValue() != 0) {
            String message = Objects.toString(result.get("msg"), "共享沙箱操作失败");
            if (message.startsWith("SHARED_USER_NAS_") || message.startsWith("NAS_")) throw storageFailure(message);
            throw new BdpRuntimeException(message);
        }
        return result.get("data");
    }

    private BdpRuntimeException storageFailure(String state) {
        String key = state.endsWith("WAITING_QUOTA") || state.endsWith("PREPARING_STORAGE")
            ? "sandbox.shared.userNas.preparing" : "sandbox.shared.userNas.failed";
        String message = ResourceBundle.getBundle("i18n.messages",
            org.springframework.context.i18n.LocaleContextHolder.getLocale()).getString(key);
        BdpRuntimeException failure = new BdpRuntimeException(message);
        failure.setErrorService(state);
        return failure;
    }

    private Map<String, Object> identity(String user, String service) {
        Map<String, Object> projection = users.build(user);
        if (projection == null || !user.equals(projection.get("userCode")) || projection.get("userId") == null) {
            throw new IllegalStateException("无法取得共享沙箱的可信用户身份");
        }
        Map<String, Object> params = new LinkedHashMap<>();
        if (StringUtils.isNotBlank(service)) params.put("requestedServiceKey", service);
        params.put("userCode", user);
        params.put("userId", projection.get("userId"));
        params.put("enterpriseId", projection.get("enterpriseId"));
        params.put("sessionId", projection.get("sessionId"));
        params.put("userInfo", projection);
        return params;
    }
}
