package com.iwhalecloud.byai.manager.domain.resource.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 资源操作类型枚举
 */
@RequiredArgsConstructor
@Getter
public enum OperationTypeEnum {
    
    CREATE("create", "创建"),
    UPDATE("update", "更新"),
    DELETE("delete", "删除"),
    PUBLISH("publish", "发布"),
    SHELF("online", "上架"),
    UNSHELF("offline", "下架"),
    AUDIT_PASS("auditPass", "审核成功"),
    AUDIT_REJECT("auditFail", "审核驳回");
    
    private final String code;
    private final String desc;
    

}
