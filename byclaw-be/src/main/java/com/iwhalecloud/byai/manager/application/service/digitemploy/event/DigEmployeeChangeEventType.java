package com.iwhalecloud.byai.manager.application.service.digitemploy.event;

/**
 * 数字员工变更事件类型，写入 Redis Stream / 通知载荷。
 */
public enum DigEmployeeChangeEventType {

    /** 元数据或主表/扩展表更新 */
    DIG_EMPLOYEE_UPDATED,

    /** 软删除或资源侧移除导致不可用 */
    DIG_EMPLOYEE_DELETED,

    /** 关联技能等已同步到 Redis 技能缓存 */
    DIG_EMPLOYEE_SKILLS_SYNCED,

    /** 新建完成（含首次技能同步后） */
    DIG_EMPLOYEE_CREATED
}
