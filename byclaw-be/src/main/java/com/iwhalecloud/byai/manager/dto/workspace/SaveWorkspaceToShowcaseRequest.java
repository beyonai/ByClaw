package com.iwhalecloud.byai.manager.dto.workspace;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 将会话工作区文件保存到成果空间请求
 *
 * @author system
 */
@Getter
@Setter
public class SaveWorkspaceToShowcaseRequest {

    /**
     * 会话工作区记录 id（byai_session_workspace 主键）
     */
    @NotNull(message = "工作区ID不能为空")
    private Long workspaceId;
}
