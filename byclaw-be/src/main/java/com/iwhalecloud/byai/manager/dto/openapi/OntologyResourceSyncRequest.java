package com.iwhalecloud.byai.manager.dto.openapi;

import com.alibaba.fastjson.JSONObject;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * datacloud 主动同步本体资源到门户资源库表的请求。
 *
 * @author qin.guoquan
 * @date 2026-07-06 16:05:00
 */
@Data
@Schema(description = "本体资源同步请求")
public class OntologyResourceSyncRequest {

    @NotBlank(message = "资源业务类型不能为空")
    @Schema(description = "资源业务类型：ONTOLOGY_BASE / SCENE / VIEW / OBJECT", required = true)
    private String resourceBizType;

    @NotBlank(message = "系统来源不能为空")
    @Schema(description = "系统来源编码，例如 byclaw-datacloud", required = true)
    private String systemCode;

    @NotBlank(message = "资源编码不能为空")
    @Schema(description = "资源编码。库级传 baseId；场景传 sceneId；视图传 viewCode；对象传 objectCode", required = true)
    private String resourceCode;

    @NotBlank(message = "资源名称不能为空")
    @Schema(description = "资源名称", required = true)
    private String resourceName;

    @Schema(description = "资源描述")
    private String resourceDesc;

    @Schema(description = "所属本体库编码。库级可不传，默认使用 resourceCode")
    private String ontologyBaseCode;

    @Schema(description = "父资源业务类型。用于对象/视图等同编码不同路径时消歧，例如 SCENE / VIEW / ONTOLOGY_BASE")
    private String parentResourceBizType;

    @Schema(description = "父资源编码。用于对象/视图等同编码不同路径时消歧")
    private String parentResourceCode;

    @Schema(description = "资源归属类型：personal / enterprise")
    private String ownerType;

    @Schema(description = "本体来源类型：LOCAL / REMOTE")
    private String sourceType;

    @Schema(description = "资源目录 ID")
    private Long catalogId;

    @Schema(description = "原始内容，写入对应扩展表 source_content")
    private String sourceContent;

    @Schema(description = "扩展元数据，可选。门户会自动补充 resource/base/parent 等定位字段后一并写入 target_content")
    private JSONObject extraContent;
}
