package com.iwhalecloud.byai.manager.dto.workspace;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 会话工作区修改名称请求
 *
 * @author system
 */
@Getter
@Setter
public class SessionWorkspaceUpdateNameRequest {

    /**
     * 工作区记录主键
     */
    @NotNull(message = "工作区ID不能为空")
    private Long id;

    /**
     * 文件名称
     */
    @NotBlank(message = "文件名称不能为空")
    @Size(max = 255, message = "文件名称长度不能超过255字符")
    private String name;
}
