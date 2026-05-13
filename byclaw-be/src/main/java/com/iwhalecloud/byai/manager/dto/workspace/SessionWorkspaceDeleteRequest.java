package com.iwhalecloud.byai.manager.dto.workspace;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 会话工作区删除请求
 *
 * @author system
 */
@Getter
@Setter
public class SessionWorkspaceDeleteRequest {

    /**
     * 工作区记录主键
     */
    @NotNull(message = "工作区ID不能为空")
    private Long id;
}
