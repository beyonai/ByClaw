package com.iwhalecloud.byai.gateway.sandbox.platform;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.fasterxml.jackson.databind.*;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import java.net.URI;
import java.util.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** 启动时固定执行侧；业务与桥接不会在网络错误后切到legacy。 */
@Component
public class PlatformRemoteGateway {
    private final boolean remote;
    private final ObjectProvider<PlatformControlClient> client;
    private final ObjectMapper json;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private com.iwhalecloud.byai.common.discovery.ApplicationServiceEndpoint businessEndpoint;

    public PlatformRemoteGateway(
            PlatformBackgroundExecution execution,
            ObjectProvider<PlatformControlClient> client,
            ObjectMapper json,
            Environment env) {
        this.remote = !execution.isLegacyExecutor();
        this.client = client;
        this.json = json;
        if (remote) {
            URI url = URI.create(env.getRequiredProperty("byclaw.platform.base-url"));
            if (!("http".equals(url.getScheme()) || "https".equals(url.getScheme()))
                    || url.getHost() == null
                    || url.getUserInfo() != null
                    || url.getRawQuery() != null
                    || url.getFragment() != null)
                throw new IllegalArgumentException("Invalid platform base URL");
        }
    }

    public boolean isRemote() {
        return remote;
    }

    public <T> T safe(java.util.function.Supplier<T> call) {
        try {
            return call.get();
        } catch (feign.FeignException failure) {
            throw new BdpRuntimeException(I18nUtil.get("platform.request.failed", failure.status()));
        }
    }

    public Map<String, Object> envelope(String area, String operation, Object params) {
        return safe(() -> client.getObject().call(area, operation, params));
    }

    public Object call(String area, String operation, Object params) {
        return data(envelope(area, operation, params));
    }

    public Object data(Map<String, Object> response) {
        if (response == null || !(response.get("code") instanceof Number))
            throw new BdpRuntimeException(I18nUtil.get("platform.response.invalid"));
        if (((Number) response.get("code")).intValue() != 0)
            throw new BdpRuntimeException(
                    Objects.toString(response.get("msg"), I18nUtil.get("platform.operation.failed")));
        return response.get("data");
    }

    public <T> T convert(Object value, Class<T> type) {
        return value == null ? null : json.convertValue(value, type);
    }

    public Object convert(Object value, java.lang.reflect.Type type) {
        return value == null
                ? null
                : json.convertValue(value, json.getTypeFactory().constructType(type));
    }

    public Object service(String operation, Map<String, Object> params) {
        params = new LinkedHashMap<>(params);
        params.put("operatorUserCode", CurrentUserHolder.getCurrentUserCode());
        if (CurrentUserHolder.getLoginInfo() != null) {
            params.put("userInfo", json.convertValue(CurrentUserHolder.getLoginInfo(), Map.class));
            params.put("sessionId", CurrentUserHolder.getLoginInfo().getSessionId());
            params.put("enterpriseId", CurrentUserHolder.getLoginInfo().getEnterpriseId());
        }
        if (businessEndpoint != null) {
            try { params.put("businessBaseUrl", businessEndpoint.getBaseUrl()); }
            catch (IllegalStateException unavailable) { /* 保留可复用分支；确需创建时由平台检查原业务地址。 */ }
        }
        return call("sandbox", "business/" + operation, params);
    }

    public Map<String, Object> params(Object... pairs) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]);
        return result;
    }

    public Map<String, Object> route(SandboxLaunchRouting route) {
        return params(
                "sandboxType",
                route.getSandboxType(),
                "profileKey",
                route.getProfileKey(),
                "effectiveResourceId",
                route.getEffectiveResourceId());
    }

    public ResponseUtil controller(String path, Map<String, Object> params) {
        Map<String, Object> response = envelope("sandbox", path, params);
        if (response == null || !(response.get("code") instanceof Number))
            throw new BdpRuntimeException(I18nUtil.get("platform.response.invalid"));
        return ((Number) response.get("code")).intValue() == 0
                ? ResponseUtil.successResponse(response.get("data"))
                : ResponseUtil.fail(
                        Objects.toString(response.get("msg"), I18nUtil.get("platform.operation.failed")));
    }

    public String metrics() {
        return safe(() -> client.getObject().metrics());
    }
}
