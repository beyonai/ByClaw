package com.iwhalecloud.byai.manager.qo.auth;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/** 资源审核中心聚合查询参数。 */
@Getter
@Setter
public class ResourceUseApplyHistoryQo {

    /** 是否查询已处理的历史审核记录。 */
    private Boolean history;

    /**
     * 资源业务类型筛选。为空时保持数字员工审核中心的兼容口径，仅查询 DIG_EMPLOYEE。
     */
    private List<String> resourceBizTypeList;

    /** 资源名称模糊搜索词，忽略首尾空格及大小写；空值不筛选。 */
    private String keyword;
}
