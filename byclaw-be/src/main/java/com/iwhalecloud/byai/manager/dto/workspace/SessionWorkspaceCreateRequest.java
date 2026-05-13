package com.iwhalecloud.byai.manager.dto.workspace;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 会话工作区新增请求
 *
 * @author system
 */
@Getter
@Setter
public class SessionWorkspaceCreateRequest {

    /**
     * 会话id
     */
    @NotNull(message = "会话ID不能为空")
    private Long sessionId;

    /**
     * 文件名称
     */
    @Size(max = 255, message = "文件名称长度不能超过255字符")
    private String name;

    /**
     * 引用数量
     */
    private Integer relCount;

    /**
     * 文件id
     */
    @Size(max = 128, message = "文件ID长度不能超过128字符")
    private String fileId;

    /**
     * 文件链接
     */
    @Size(max = 500, message = "文件链接长度不能超过500字符")
    private String fileUrl;

    /**
     * 文件图标
     */
    @Size(max = 255, message = "文件图标长度不能超过255字符")
    private String icon;
}
