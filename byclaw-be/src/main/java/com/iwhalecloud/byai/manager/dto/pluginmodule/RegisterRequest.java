package com.iwhalecloud.byai.manager.dto.pluginmodule;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import jakarta.validation.constraints.NotBlank;
import java.io.Serial;
import java.io.Serializable;

@Data
@Schema(description = "插件模块注册请求")
public class RegisterRequest implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @NotBlank(message = "ip不能为空")
    @Schema(description = "注册的IP地址", example = "192.168.1.100", requiredMode = Schema.RequiredMode.REQUIRED)
    private String ip;

    @Schema(description = "注册的端口号", example = "8080")
    private Integer port;
}
