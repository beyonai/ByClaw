package com.iwhalecloud.byai.manager.qo.auth;

import lombok.Getter;
import lombok.Setter;

/** 审核中心聚合查询参数。 */
@Getter
@Setter
public class ResourceUseApplyHistoryQo {

    /** 是否查询已处理的历史审核记录。 */
    private Boolean history;
}
