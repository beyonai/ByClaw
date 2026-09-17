package com.iwhalecloud.byai.manager.qo.index;

import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-11-12 23:57:45
 * @description TODO
 */
@Getter
@Setter
public class RecentlyAddedQo extends AuthQo {

    /**
     * 资源状态筛选。有值时按该状态过滤；未传时 SQL 默认查 resource_status = 2（已上架）。
     */
    private Integer resourceStatus;
}
