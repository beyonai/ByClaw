package com.iwhalecloud.byai.manager.dto.openapi;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 开放接口权限批量校验结果。
 *
 * @author qin.guoquan
 * @date 2026-07-04 22:00:38
 */
@Getter
@Setter
public class OpenPermissionCheckResultDto {

    /**
     * 是否全部校验通过。
     */
    private boolean allPermitted;

    /**
     * 单项校验结果。
     */
    private List<Item> items = new ArrayList<>();

    @Getter
    @Setter
    public static class Item {

        private Long resourceId;

        private String resourceCode;

        private String resourceName;

        private String resourceBizType;

        private boolean exists;

        private boolean hasPermission;

        private String message;
    }
}
