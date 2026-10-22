package com.iwhalecloud.byai.gateway.sandbox.runtime;

import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/** Read-only management snapshot, outside JDBC transactions and without cross-engine fallback. */
@Component
public class SandboxRuntimeInventory {
    private static final Logger LOG = LoggerFactory.getLogger(SandboxRuntimeInventory.class);
    private final ObjectProvider<PlatformRemoteGateway> gateways;
    private final ObjectProvider<SandboxRuntimeProvider> runtimes;

    public SandboxRuntimeInventory(ObjectProvider<PlatformRemoteGateway> gateways,
                                   ObjectProvider<SandboxRuntimeProvider> runtimes) {
        this.gateways = gateways;
        this.runtimes = runtimes;
    }

    public Map<String, String> current() {
        try {
            return load();
        } catch (RuntimeException failure) {
            LOG.warn("Active sandbox inventory unavailable; returning an empty management list ({})",
                failure.getClass().getSimpleName());
            return Map.of();
        }
    }

    private Map<String, String> load() {
        PlatformRemoteGateway gateway = gateways.getIfAvailable();
        boolean remote = gateway != null && gateway.isRemote();
        Map<String, String> result = new LinkedHashMap<>();
        String provider = null;
        for (int pageNo = 1; pageNo <= 100; pageNo++) {
            int before = result.size();
            boolean hasNext;
            if (remote) {
                Object value = gateway.call("sandbox", "runtime/list", Map.of("pageNo", pageNo, "pageSize", 500));
                if (!(value instanceof Map<?, ?> snapshot)) throw new IllegalStateException("Invalid runtime snapshot");
                if (Boolean.FALSE.equals(snapshot.get("available"))) return Map.of();
                Object selected = snapshot.get("provider");
                if (!(selected instanceof String) || (provider != null && !provider.equals(selected))) {
                    throw new IllegalStateException("Runtime changed while reading inventory");
                }
                provider = (String) selected;
                if (!(snapshot.get("page") instanceof Map<?, ?> page)
                    || !(page.get("items") instanceof List<?> items)
                    || !(page.get("hasNext") instanceof Boolean)) throw new IllegalStateException("Invalid runtime page");
                for (Object item : items) {
                    if (!(item instanceof Map<?, ?> instance) || !(instance.get("sandboxId") instanceof String)) {
                        throw new IllegalStateException("Invalid runtime instance");
                    }
                    result.put((String) instance.get("sandboxId"), state(Objects.toString(instance.get("state"), "")));
                }
                hasNext = Boolean.TRUE.equals(page.get("hasNext"));
            } else {
                SandboxRuntimePage<SandboxRuntimeInstance> page = runtimes.getObject()
                    .listSandboxesByMetadata(Map.of(), pageNo, 500);
                if (page == null || page.getItems() == null) throw new IllegalStateException("Invalid runtime page");
                for (SandboxRuntimeInstance instance : page.getItems()) {
                    if (instance == null || instance.getSandboxId() == null) throw new IllegalStateException("Invalid runtime instance");
                    result.put(instance.getSandboxId(), state(instance.getState()));
                }
                hasNext = page.isHasNext();
            }
            if (!hasNext) return result;
            if (before == result.size()) throw new IllegalStateException("Runtime inventory pagination made no progress");
        }
        throw new IllegalStateException("Runtime inventory exceeds supported page limit");
    }

    private static String state(String value) {
        return switch (value == null ? "" : value.toUpperCase(Locale.ROOT)) {
            case "RUNNING" -> "RUNNING";
            case "PENDING", "CREATING", "STARTING", "INITIALIZING" -> "STARTING";
            case "TERMINATING", "STOPPING" -> "RELEASING";
            case "FAILED", "ERROR" -> "FAILED";
            case "SUCCEEDED", "STOPPED", "TERMINATED" -> "RELEASED";
            default -> "UNKNOWN";
        };
    }
}
