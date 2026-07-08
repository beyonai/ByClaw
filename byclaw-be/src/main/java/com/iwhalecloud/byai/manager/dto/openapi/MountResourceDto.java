package com.iwhalecloud.byai.manager.dto.openapi;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-05-20 14:39:34
 * @description TODO
 */
@Getter
@Setter
public class MountResourceDto {

    /**
     * 数字员工资源ID。
     */
    private Long agentId;

    /**
     * 待绑定资源ID。与 relResourceCode 二选一，优先建议传资源ID。
     */
    private Long relResourceId;

    /**
     * 待绑定资源编码。按编码绑定时可单独传入。
     */
    private String relResourceCode;

    /**
     * 待绑定资源业务类型，例如 VIEW / OBJECT。可选，传入时用于兼容旧调用并缩小资源匹配范围。
     */
    private String relResourceBizType;

    /**
     * 所属本体库编码。可选，传入时用于兼容旧调用并缩小本体资源匹配范围。
     */
    private String ontologyBaseCode;

}
