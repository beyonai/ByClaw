package com.iwhalecloud.byai.manager.dto.workspace;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 会话工作区批量新增请求
 * sessionId、relCount 公用，文件信息以列表传入
 *
 * @author system
 */
@Getter
@Setter
public class SessionWorkspaceBatchCreateRequest {

    /**
     * 会话id（公用）
     */
    @NotNull(message = "会话ID不能为空")
    private Long sessionId;

    /**
     * 引用数量（公用）
     */
    private Integer relCount;

    /**
     * 文件列表：每条包含 name、fileId、fileUrl、icon
     */
    @NotEmpty(message = "文件列表不能为空")
    @Valid
    private List<SessionWorkspaceFileItem> fileList;
}
