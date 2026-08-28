package com.iwhalecloud.byai.manager.qo.index;

import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * @author he.duming
 * @date 2025-11-13 00:40:04
 * @description TODO
 */
@Getter
@Setter
public class MyAuthEmployQo extends AuthQo {

    /**
     * 按用户近 90 天使用频次降序排列,设置从前90天开始
     */
    private Date recentlyStartDate;

    /**
     * all:全部,owner:我创建的,authorize:授权给我的
     */
    private String type = "all";

    /**
     * 数字员工类型。017 表示数字员工组；为空时保持历史行为，查询全部类型。
     */
    private String agentType;

    /**
     * 是否排除数字员工组。true 时排除 agentType=017。
     */
    private Boolean excludeEmployeeGroup;

    private String machineChannel;
}
