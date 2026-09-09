package com.iwhalecloud.byai.manager.qo.index;

import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * @author he.duming
 * @date 2025-11-12 23:59:19
 * @description TODO
 */
@Getter
@Setter
public class MyUsualQo extends AuthQo {

    /**
     * 按用户近 90 天使用频次降序排列,设置从前90天开始
     */
    private Date recentlyStartDate;

    /**
     * 资源状态筛选。有值时按该状态过滤；未传时 SQL 默认查 resource_status = 2（已上架）。
     */
    private Integer resourceStatus;
}
