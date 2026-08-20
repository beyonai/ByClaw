package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/** QA 知识实体补全请求，对应 POST /api/v1/knowledgeItems/entityEnrich。
 *
 * @author qin.guoquan
 * @date 2026-08-19 16:25:38
 * */
@Getter
@Setter
public class KbEntityEnrich {

    private String knCode;

    private String filePath;

    private Integer topK;

    private Boolean force;

    private Map<String, Object> extraParams = new LinkedHashMap<>();
}
