package com.iwhalecloud.byai.state.domain.sys.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 应用版本新增/编辑请求。
 * <p>
 * 不含 deviceType：桌面端版本固定落 electron，避免调用方传错导致客户端收不到更新。
 * </p>
 */
@Data
public class AppVersionRequest {

    @NotBlank
    @Pattern(regexp = "windows|macos", message = "{app.version.platformInvalid}")
    private String platform;

    @NotBlank
    @Pattern(regexp = "x64|arm64|universal", message = "{app.version.archInvalid}")
    private String arch;

    @NotBlank
    @Pattern(regexp = "stable|beta|dev", message = "{app.version.channelInvalid}")
    private String channel;

    @NotBlank
    @Size(max = 32)
    @Pattern(regexp = "\\d+\\.\\d+\\.\\d+([-+][0-9A-Za-z.-]+)?", message = "{app.version.numberInvalid}")
    private String appVersion;

    @NotBlank
    @Size(max = 1000)
    private String url;

    @Pattern(regexp = "^(full|incremental)?$", message = "{app.version.updateTypeInvalid}")
    private String updateType;

    @Size(max = 2000)
    private String updateMsg;

    /**
     * 是否强制更新，落库为 update_status 的 "1"/"0"。
     */
    private Boolean forceUpdate;

    @Size(max = 255)
    private String fileName;

    private Long fileSize;

    @Pattern(regexp = "^([0-9a-fA-F]{64})?$", message = "{app.version.shaInvalid}")
    private String sha256;

    /**
     * 草稿或直接发布，下线走独立接口。
     */
    @Pattern(regexp = "^(draft|published)?$", message = "{app.version.statusInvalid}")
    private String releaseStatus;
}