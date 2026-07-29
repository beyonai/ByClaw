package com.iwhalecloud.byai.manager.dto.ontology;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * 本体库浏览/删除通用请求：本体库列表、场景列表、场景详情、对象详情、删除本体库共用。
 *
 * @author qin.guoquan
 * @date 2026-06-29 17:38:38
 */
@Data
@Schema(description = "本体库浏览/删除通用请求")
public class OntologyBaseQueryRequest {

    @Schema(description = "资源归属类型：personal / enterprise", example = "personal")
    private String ownerType;

    @Schema(description = "本体库 ID", example = "crm_demo")
    private String baseId;

    @Schema(description = "场景 ID")
    private String sceneId;

    @Schema(description = "对象编码")
    private String objectCode;

    @Schema(description = "视图编码")
    private String viewCode;

    @Schema(description = "关键词过滤")
    private String queryKeyword;
}
