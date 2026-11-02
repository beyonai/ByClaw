package com.iwhalecloud.byai.common.hook;

import java.util.Set;

/** A business-owned, versioned whitelist of fields available to external hooks. */
public record HookEventSchema(String type, int version, Set<String> dataFields) {
    public HookEventSchema {
        dataFields = Set.copyOf(dataFields);
    }
}
