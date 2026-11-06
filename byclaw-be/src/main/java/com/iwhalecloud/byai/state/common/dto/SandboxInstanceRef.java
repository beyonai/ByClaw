package com.iwhalecloud.byai.state.common.dto;

import java.util.*;
import lombok.Data;

/** Credential-free identity of an instance actually used by a tool. */
@Data
public class SandboxInstanceRef {
    private String sandboxId;
    private String instance;
    private String mappingId;

    public static List<SandboxInstanceRef> merge(List<SandboxInstanceRef> previous, List<SandboxInstanceRef> incoming) {
        if (previous == null && incoming == null) return null;
        Map<List<String>, SandboxInstanceRef> refs = new LinkedHashMap<>();
        for (List<SandboxInstanceRef> batch : Arrays.asList(previous, incoming)) {
            if (batch == null) continue;
            for (SandboxInstanceRef ref : batch) {
                if (ref == null || ref.sandboxId == null || ref.sandboxId.trim().isEmpty()
                    || ref.instance == null || ref.instance.trim().isEmpty()
                    || !ref.sandboxId.equals(ref.sandboxId.trim()) || !ref.instance.equals(ref.instance.trim())
                    || (ref.mappingId != null && (ref.mappingId.trim().isEmpty() || !ref.mappingId.equals(ref.mappingId.trim())))) continue;
                SandboxInstanceRef normalized = new SandboxInstanceRef();
                normalized.sandboxId = ref.sandboxId;
                normalized.instance = ref.instance;
                normalized.mappingId = ref.mappingId;
                refs.putIfAbsent(Arrays.asList(normalized.sandboxId, normalized.mappingId, normalized.instance), normalized);
            }
        }
        return new ArrayList<>(refs.values());
    }
}
