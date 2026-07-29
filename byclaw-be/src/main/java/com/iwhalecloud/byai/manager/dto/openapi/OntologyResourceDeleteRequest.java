package com.iwhalecloud.byai.manager.dto.openapi;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * datacloud 主动删除门户本体资源索引的请求。
 *
 * @author qin.guoquan
 * @date 2026-07-06 16:05:00
 */
@Data
@Schema(description = "本体资源删除同步请求")
public class OntologyResourceDeleteRequest {

    @NotBlank(message = "资源业务类型不能为空")
    @Schema(description = "资源业务类型：ONTOLOGY_BASE / SCENE / VIEW / OBJECT", required = true)
    private String resourceBizType;

    @NotBlank(message = "系统来源不能为空")
    @Schema(description = "系统来源编码，例如 byclaw-datacloud", required = true)
    private String systemCode;

    @NotBlank(message = "资源编码不能为空")
    @Schema(description = "资源编码。库级传 baseId；场景传 sceneId；视图传 viewCode；对象传 objectCode", required = true)
    private String resourceCode;

    @Schema(description = "所属本体库编码。库级可不传，默认使用 resourceCode")
    private String ontologyBaseCode;

    @Schema(description = "父资源业务类型。用于对象/视图等同编码不同路径时消歧")
    private String parentResourceBizType;

    @Schema(description = "父资源编码。用于对象/视图等同编码不同路径时消歧")
    private String parentResourceCode;
}
