package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.util.Collections;
import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SandboxRuntimePage<T> {

    private List<T> items;

    private int pageNo;

    private int pageSize;

    private boolean hasNext;

    public List<T> safeItems() {
        return items != null ? items : Collections.emptyList();
    }

    public static <T> SandboxRuntimePage<T> empty(int pageNo, int pageSize) {
        return SandboxRuntimePage.<T>builder()
            .items(Collections.emptyList())
            .pageNo(pageNo)
            .pageSize(pageSize)
            .hasNext(false)
            .build();
    }
}
