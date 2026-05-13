package com.iwhalecloud.byai.manager.dto.men;

import lombok.Data;

import java.util.List;

/**
 * 批量查询资源组件请求参数
 */
@Data
public class MenResComQueryQo {
    
    /**
     * 资源组件ID列表
     */
    private List<Long> resComIds;
} 