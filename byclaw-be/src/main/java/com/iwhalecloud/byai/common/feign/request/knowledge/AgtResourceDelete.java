package com.iwhalecloud.byai.common.feign.request.knowledge;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-21 14:05:45
 * @description TODO
 */

@Getter
@Setter
public class AgtResourceDelete {

    /**
     * 资源id
     */
    @NotNull(message = "{agtresourcedelete.resourceid.notnull}")
    private Long resourceId;

    private Long resourceProjectId;

    /**
     * 资源对象id (知识库ld)
     */
    @NotNull(message = "{agtresourcedelete.objectid.notnull}")
    private Long objId;

    /**
     * 资源类型,知识库为2
     */
    private int queryResourceType;

    /**
     * 唯一标识ID
     */
    private Long id;

    /**
     * 资源类型数值
     * 知识库固定为2，智能体为1
     */
    @NotNull(message = "{agtresourcedelete.type.notnull}")
    private Long resourceType;

}
