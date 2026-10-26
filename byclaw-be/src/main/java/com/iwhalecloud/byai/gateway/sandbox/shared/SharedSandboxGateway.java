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
        if (!eligible) return null;
        if (clients.getIfAvailable() == null) {
            throw new BdpRuntimeException("共享沙箱需要配置 byclaw.platform.base-url");
        }
        Map<String, Object> identity = identity(user, type);
        Object existing = call("lookup", identity);
        if (existing != null) {
            observedSharedUsers.put(user, true);
            return json.convertValue(existing, SandboxLaunchData.class);
        }
        identity.put("byTenant", policy.byTenant());
        Object allocated = call("acquire", identity);
        if (allocated != null) observedSharedUsers.put(user, true);
        return allocated == null ? null : json.convertValue(allocated, SandboxLaunchData.class);
    }

    public String currentWorkerTarget(String user) {
        SandboxLaunchData data = lookup(user, DSH_SERVICE);
        return data == null ? null : data.getWorkerAgentType();
    }

    private SandboxLaunchData lookup(String user, String service) {
        if (clients.getIfAvailable() == null || StringUtils.isBlank(user)) return null;
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
        if (Boolean.TRUE.equals(observedSharedUsers.get(user))) return true;
        try {
            return policy.eligible(user);
        }
        catch (RuntimeException unavailable) {
            // Heartbeat never allocates: keep the existing exclusive path available.
            return false;
        }
    }

    public boolean release(String user) {
        if (clients.getIfAvailable() == null || StringUtils.isBlank(user)) return false;
        Object count = call("releaseAll", identity(user, null));
        if (!(count instanceof Number)) throw new BdpRuntimeException("共享释放响应格式错误");
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
        if (code.intValue() != 0) throw new BdpRuntimeException(Objects.toString(result.get("msg"), "共享沙箱操作失败"));
        return result.get("data");
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
