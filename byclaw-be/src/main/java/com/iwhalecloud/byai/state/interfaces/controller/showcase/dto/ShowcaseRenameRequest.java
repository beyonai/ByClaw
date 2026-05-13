package com.iwhalecloud.byai.state.interfaces.controller.showcase.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 成果空间重命名请求
 *
 * @author system
 * @date 2025-11-14
 */
@Setter
@Getter
public class ShowcaseRenameRequest {

    /**
     * 主键
     */
    @NotNull(message = "成果空间ID不能为空")
    private Long id;

    /**
     * 新名称
     */
    @NotBlank(message = "成果空间名称不能为空")
    @Size(max = 256, message = "成果空间名称长度不能超过256字符")
    private String name;
}

