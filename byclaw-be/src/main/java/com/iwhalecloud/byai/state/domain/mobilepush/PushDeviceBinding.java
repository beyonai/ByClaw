package com.iwhalecloud.byai.state.domain.mobilepush;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 设备 ID 是安装实例标识，不是认证凭据；接收账号只能由服务端登录上下文决定。 */
public record PushDeviceBinding(
    @NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{16,128}") String installationId,
    @Min(1) @Max(9007199254740991L) long revision,
    @NotBlank @Size(max = 256) String registrationId,
    @NotBlank @Pattern(regexp = "ios|android") String platform,
    @NotBlank @Size(max = 32) String language
) {
}
