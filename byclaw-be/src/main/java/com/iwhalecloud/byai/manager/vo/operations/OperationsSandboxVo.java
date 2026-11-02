package com.iwhalecloud.byai.manager.vo.operations;

import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import lombok.Getter;
import lombok.Setter;

/** 运营查询扩展字段，仅由服务转换为白名单响应。
 * @author Codex
 * @since 2026-10-23
 */
@Getter
@Setter
public class OperationsSandboxVo extends SsSandboxRecord {
    private String userName;
    private String enterpriseName;
    private boolean currentRecord;
    private boolean userActive;
}

