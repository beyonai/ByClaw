package com.iwhalecloud.byai.manager.dto.workspace;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 批量将会话工作区文件保存到成果空间请求
 *
 * @author system
 */
@Getter
@Setter
public class SaveWorkspaceToShowcaseBatchRequest {

    /**
     * 会话工作区记录 id 列表（byai_session_workspace 主键），按顺序依次保存到成果空间
     */
    @NotEmpty(message = "工作区ID列表不能为空")
    private List<Long> workspaceIds;
}
