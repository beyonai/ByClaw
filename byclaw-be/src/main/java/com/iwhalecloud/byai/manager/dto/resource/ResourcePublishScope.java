package com.iwhalecloud.byai.manager.dto.resource;

import com.iwhalecloud.byai.common.exception.BaseException;
import java.util.List;

/** COMPANY and ORGS are explicit requests; NONE/LEGACY are server-owned states. */
public record ResourcePublishScope(String mode, List<Long> orgIds) {
    public static ResourcePublishScope company() { return new ResourcePublishScope("COMPANY", List.of()); }

    public List<Long> selectedIds() {
        if ("COMPANY".equals(mode) && (orgIds == null || orgIds.isEmpty())) return List.of(-1L);
        if (!"ORGS".equals(mode) || orgIds == null || orgIds.isEmpty()
            || orgIds.size() > 200 || orgIds.stream().anyMatch(id -> id == null || id <= 0)) {
            throw new BaseException("请选择全公司或有效的发布组织；全公司不能同时选择组织");
        }
        return orgIds.stream().distinct().sorted().toList();
    }
}
