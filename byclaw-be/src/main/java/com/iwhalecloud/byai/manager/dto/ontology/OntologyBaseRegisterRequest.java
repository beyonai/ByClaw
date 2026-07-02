package com.iwhalecloud.byai.manager.dto.ontology;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import java.util.Map;
import lombok.Data;

/**
 * 本体库注册请求：不填 sourceUrl 即 LOCAL 自建；填了 sourceUrl 即 REMOTE 外部注册。
 *
 * @author qin.guoquan
 * @date 2026-06-29 17:38:38
 */
@Data
@Schema(description = "本体库注册请求")
public class OntologyBaseRegisterRequest {

    @NotBlank(message = "显示名称不能为空")
    @Schema(description = "显示名称", required = true)
    private String displayName;

    @NotBlank(message = "描述不能为空")
    @Schema(description = "描述", required = true)
    private String description;

    @Schema(description = "本体库 ID，可选；不传由 datacloud 雪花生成", example = "crm_demo")
    private String baseId;

    @Schema(description = "资源归属类型：personal / enterprise", example = "personal")
    private String ownerType;

    @Schema(description = "所属资源目录 ID（前端注册时选择）", example = "0")
    private Long catalogId;

    @Schema(description = "外部服务地址；填写即注册为 REMOTE")
    private String sourceUrl;

    @Schema(description = "鉴权类型：none / api_key / bearer / oauth2")
    private String authType;

    @Schema(description = "鉴权配置，转发时注入 HTTP header")
    private Map<String, Object> authConfig;

    @Schema(description = "转发超时秒数，默认 30")
    private Integer timeoutSec;
}
