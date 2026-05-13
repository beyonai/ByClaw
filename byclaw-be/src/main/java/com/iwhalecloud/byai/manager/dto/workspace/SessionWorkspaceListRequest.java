package com.iwhalecloud.byai.manager.dto.workspace;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 会话工作区列表查询请求
 *
 * @author system
 */
@Getter
@Setter
public class SessionWorkspaceListRequest {

    /**
     * 会话id，必填，按会话维度查询
     */
    @NotNull(message = "会话ID不能为空")
    private Long sessionId;

    private String keyword;

}
