package com.iwhalecloud.byai.manager.qo.resource;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;

/**
 * 查询资源目录关联树请求对象
 * 
 * @author system
 * &#064;date  2025-01-XX
 */
@Data
public class QueryResourceCatalogTreeRequest implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 目录类型（可选，6-领域活动对象，7-核心业务对象）
     */
    @NotNull(message = "目录类型（catalogType）不能为空")
    private Integer catalogType;

}

