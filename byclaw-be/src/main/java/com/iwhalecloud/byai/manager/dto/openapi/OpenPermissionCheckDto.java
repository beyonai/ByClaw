package com.iwhalecloud.byai.manager.dto.openapi;

import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 开放接口权限批量校验入参。
 *
 * @author qin.guoquan
 * @date 2026-07-04 22:00:38
 */
@Getter
@Setter
public class OpenPermissionCheckDto {

    /**
     * 数字员工资源ID列表。
     */
    private List<Long> agentIds;

    /**
     * 资源ID列表。
     */
    private List<Long> resourceIds;

    /**
     * 资源编码定位列表。按编码校验时使用，不可与 resourceIds 同时传。
     */
    private List<ResourceCodeRef> resources;

    /**
     * 资源编码列表。兼容同一资源类型下的批量编码校验。
     */
    private List<String> resourceCodes;

    /**
     * 资源业务类型。可选，传入时用于缩小资源匹配范围。
     */
    private String resourceBizType;

    /**
     * 所属本体库编码。可选，传入时用于缩小本体资源匹配范围。
     */
    private String ontologyBaseCode;

    @Getter
    @Setter
    public static class ResourceCodeRef {

        /**
         * 资源业务类型。可选，传入时用于缩小资源匹配范围。
         */
        private String resourceBizType;

        /**
         * 资源编码。
         */
        private String resourceCode;

        /**
         * 所属本体库编码。可选，传入时用于缩小本体资源匹配范围。
         */
        private String ontologyBaseCode;
    }
}
