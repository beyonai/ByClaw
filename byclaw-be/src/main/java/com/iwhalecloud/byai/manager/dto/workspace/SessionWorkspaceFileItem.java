package com.iwhalecloud.byai.manager.dto.workspace;

import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 会话工作区单条文件项（用于批量新增）
 *
 * @author system
 */
@Getter
@Setter
public class SessionWorkspaceFileItem {

    /**
     * 文件名称
     */
    @Size(max = 255, message = "文件名称长度不能超过255字符")
    private String name;

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
