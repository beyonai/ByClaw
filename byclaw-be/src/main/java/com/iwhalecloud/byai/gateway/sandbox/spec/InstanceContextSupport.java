package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.alibaba.fastjson.JSON;
import java.util.*;

/** Builds credential-free snapshots once, then projects only authorized endpoints. */
public final class InstanceContextSupport {
    private InstanceContextSupport() { }
    public static Map<String, Object> snapshot(SandboxServiceSpec spec) {
        if (spec == null || spec.getPorts() == null) return null;
        Map<String, Map<String, String>> descriptors = new LinkedHashMap<>();
        Set<String> names = new HashSet<>();
        for (PortSpec port : spec.getPorts()) {
            if (port == null || port.getInstance() == null || port.getPort() == null
                || port.getPort() < 1 || port.getPort() > 65535 || !names.add(port.getInstance())) return null;
            Map<String, String> presentation = port.getPresentation();
            if (presentation == null || presentation.get("viewer") == null) continue;
            Map<String, String> safe = new LinkedHashMap<>();
            safe.put("viewer", presentation.get("viewer"));
            if (presentation.get("label") != null) safe.put("label", presentation.get("label"));
            descriptors.put(port.getInstance(), safe);
        }
        // Legacy specs must keep absent reference metadata so existing tool viewer fallbacks still apply.
        if (spec.getInstanceBindings() == null && descriptors.isEmpty()) return null;
        Map<String, List<String>> bindings = new LinkedHashMap<>();
        if (spec.getInstanceBindings() != null) {
            for (Map.Entry<String, List<String>> entry : spec.getInstanceBindings().entrySet()) {
                if (entry.getValue() == null || !names.containsAll(entry.getValue())) return null;
                bindings.put(entry.getKey(), new ArrayList<>(new LinkedHashSet<>(entry.getValue())));
            }
        }
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("version", 1);
        snapshot.put("instanceBindings", bindings);
        snapshot.put("instanceDescriptors", descriptors);
        return snapshot;
    }
    @SuppressWarnings("unchecked")
    public static Map<String, Object> restore(String snapshot, String sandboxId, String mappingId, Set<String> authorized) {
        if (snapshot == null || sandboxId == null) return null;
        try {
            Map<String, Object> value = JSON.parseObject(snapshot);
            if (!Integer.valueOf(1).equals(value.get("version"))) return null;
            Map<String, Object> descriptors = (Map<String, Object>) value.get("instanceDescriptors");
            Map<String, Object> bindings = (Map<String, Object>) value.get("instanceBindings");
            if (descriptors == null || bindings == null) return null;
            descriptors.keySet().retainAll(authorized);
            // Optional snapshot damage must not break typed launch responses or runtime reuse.
            for (Object descriptor : descriptors.values()) {
                if (!(descriptor instanceof Map)) return null;
                Map<?, ?> presentation = (Map<?, ?>) descriptor;
                if (!(presentation.get("viewer") instanceof String)) return null;
                for (Object field : presentation.values()) if (!(field instanceof String)) return null;
            }
            for (Object targets : bindings.values()) ((List<?>) targets).removeIf(name -> !authorized.contains(name));
            value.put("sandboxId", sandboxId);
            if (mappingId != null) value.put("mappingId", mappingId);
            return value;
        } catch (RuntimeException invalid) { return null; }
    }
    @SuppressWarnings("unchecked")
    public static Map<String, Map<String, String>> descriptors(Map<String, Object> context) {
        return context == null ? null : (Map<String, Map<String, String>>) context.get("instanceDescriptors");
    }
}
