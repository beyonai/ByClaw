package com.iwhalecloud.byai.manager.vo.auth;

import lombok.Getter;
import lombok.Setter;

/**
 * 固定入口按钮能力视图对象。
 * 用于统一返回当前登录用户对企业知识/工具/视图/对象导入入口的可操作性，
 * 避免前端在多个页面中自行拼接角色判断逻辑。
 *
 * @author qin.guoquan
 * @date 2026-04-24 19:08:00
 */
@Getter
@Setter
public class FixedEntryOperationCapabilityVo {

    private Boolean canImportEnterpriseKg;

    private Boolean canImportEnterpriseToolkit;

    private Boolean canImportEnterpriseView;

    private Boolean canImportEnterpriseObject;
}
