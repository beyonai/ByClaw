package com.iwhalecloud.byai.common.feign.response.knowledge;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/**
 * 资源操作请求类
 * 用于上架资源和下架资源接口
 */
public class ShelfDto {
    
    /**
     * 资源ID列表
     * 不能为空，且至少包含一个元素
     */
    @NotEmpty(message = "{shelfdto.ids.notempty}")
    private List<Long> resourceIds;

    /**
     * 资源ObjId
     */
    private Long objId;

    /**
     * 资源类型
     */
    private String resourceType;

    public Long getObjId() {
        return objId;
    }

    public void setObjId(Long objId) {
        this.objId = objId;
    }

    public String getResourceType() {
        return resourceType;
    }

    public void setResourceType(String resourceType) {
        this.resourceType = resourceType;
    }

    /**
     * 获取资源ID列表
     * @return 资源ID列表
     */
    public List<Long> getResourceIds() {
        return resourceIds;
    }
    
    /**
     * 设置资源ID列表
     * @param resourceIds 资源ID列表
     */
    public void setResourceIds(List<Long> resourceIds) {
        this.resourceIds = resourceIds;
    }
}