package com.iwhalecloud.byai.state.domain.resource.bo;

import com.iwhalecloud.byai.common.util.ListUtil;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * @author he.duming
 * @date 2026-02-03 20:44:03
 * @description TODO
 */

public class AuthContextBo {

    public AuthContextBo(Set<Long> allAuthResourceIds, Map<String, List<Long>> allAuthResourceTypeMap) {
        this.allAuthResourceIds = allAuthResourceIds;
        this.allAuthResourceTypeMap = allAuthResourceTypeMap;
    }

    /**
     * 所有授权资源标识
     */
    private Set<Long> allAuthResourceIds;

    /**
     * 所有授权资源标识
     */
    private Map<String, List<Long>> allAuthResourceTypeMap;

    /**
     * 根据类型获取授权资源
     * 
     * @param resourceBizTypes 资源类型,可变数组
     * @return List
     */
    public List<Long> getAuthResourceIds(String... resourceBizTypes) {

        List<Long> authResourceIds = new ArrayList<>();

        // 组装资源类型返回
        for (String resourceBizType : resourceBizTypes) {
            List<Long> resourceIds = this.allAuthResourceTypeMap.get(resourceBizType);
            if (ListUtil.isEmpty(resourceIds)) {
                continue;
            }
            authResourceIds.addAll(resourceIds);
        }
        return authResourceIds;
    }

    /**
     * 是否授权资源
     * 
     * @param resourceId 资源标识
     * @return boolean
     */
    public boolean isAuthResourceId(Long resourceId) {
        return allAuthResourceIds.contains(resourceId);
    }
}
