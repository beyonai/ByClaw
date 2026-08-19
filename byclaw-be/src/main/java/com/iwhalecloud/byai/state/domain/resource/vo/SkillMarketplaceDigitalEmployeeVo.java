package com.iwhalecloud.byai.state.domain.resource.vo;

import lombok.Data;

/**
 * 技能超市安装时可供当前用户选择的数字员工。
 */
@Data
public class SkillMarketplaceDigitalEmployeeVo {

    /** 数字员工资源 ID，也是第三方技能安装接口的 digId。 */
    private Long digId;

    /** 数字员工名称，用于技能超市安装弹窗展示。 */
    private String digName;
}
