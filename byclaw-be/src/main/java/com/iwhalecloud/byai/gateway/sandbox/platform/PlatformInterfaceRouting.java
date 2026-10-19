package com.iwhalecloud.byai.gateway.sandbox.platform;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import java.lang.reflect.*;
import java.util.*;

public final class PlatformInterfaceRouting {
    private PlatformInterfaceRouting() {}

    public static <T> T create(
            Class<T> api, T legacy, PlatformRemoteGateway gateway, boolean lifecycle) {
        return api.cast(
                Proxy.newProxyInstance(
                        api.getClassLoader(),
                        new Class<?>[] {api},
                        (proxy, method, args) -> {
                            if (method.getDeclaringClass() == Object.class || !gateway.isRemote()) {
                                try {
                                    return method.invoke(legacy, args);
                                } catch (InvocationTargetException failure) {
                                    throw failure.getCause();
                                }
                            }
                            Object[] values = args == null ? new Object[0] : args;
                            String operation;
                            Object request;
                            if (lifecycle) {
                                switch (method.getName()) {
                                    case "launchSandbox":
                                        operation = "launch";
                                        request = values[0];
                                        break;
                                    case "removeSandbox":
                                        operation = "remove";
                                        request = values[0];
                                        break;
                                    case "renewSandbox":
                                        operation = "renew";
                                        request = values[0];
                                        break;
                                    case "getSandbox":
                                        operation = "get";
                                        request = values[0];
                                        break;
                                    case "sandboxExists":
                                        operation = "exists";
                                        request = values[0];
                                        break;
                                    case "listSandboxesByMetadata":
                                        operation = "list";
                                        request =
                                                gateway.params(
                                                        "metadata",
                                                        values[0],
                                                        "pageNo",
                                                        values[1],
                                                        "pageSize",
                                                        values[2]);
                                        break;
                                    default:
                                        throw new UnsupportedOperationException(
                                                "Unmapped platform lifecycle method");
                                }
                                Map<String, Object> envelope =
                                        gateway.envelope("sandbox", operation, request);
                                if (envelope == null || !(envelope.get("code") instanceof Number))
                                    throw new IllegalStateException(I18nUtil.get("platform.response.invalid"));
                                Object data = envelope.get("data");
                                Type type =
                                        ((ParameterizedType) method.getGenericReturnType())
                                                .getActualTypeArguments()[0];
                                Object converted = gateway.convert(data, type);
                                SandboxResponse<Object> result =
                                        ((Number) envelope.get("code")).intValue() == 0
                                                ? SandboxResponse.success(converted)
                                                : SandboxResponse.error(
                                                        Objects.toString(
                                                                envelope.get("msg"),
                                                                I18nUtil.get("platform.operation.failed")));
                                result.setData(converted);
                                return result;
                            }
                            Map<String, Object> command = gateway.params("sandboxId", values[0]);
                            switch (method.getName()) {
                                case "run":
                                case "start":
                                    command.put("request", values[1]);
                                    operation = method.getName();
                                    break;
                                case "inspect":
                                    operation = "inspect";
                                    command.put("processId", values[1]);
                                    break;
                                case "readOutput":
                                    operation = "read-output";
                                    command.put("processId", values[1]);
                                    command.put("cursor", values[2]);
                                    break;
                                case "terminate":
                                    operation = "terminate";
                                    command.put("processId", values[1]);
                                    break;
                                default:
                                    throw new UnsupportedOperationException(
                                            "Unmapped platform command method");
                            }
                            Object data = gateway.call("sandbox", "command/" + operation, command);
                            return method.getReturnType() == Void.TYPE
                                    ? null
                                    : gateway.convert(data, method.getGenericReturnType());
                        }));
    }
}
