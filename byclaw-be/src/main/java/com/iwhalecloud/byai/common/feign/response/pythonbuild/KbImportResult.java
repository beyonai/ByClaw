package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-04-02
 * @description knowledge-items/import 响应 data
 */
@Getter
@Setter
public class KbImportResult {

    /**
     * 知识库编码
     */
    private Long fileId;

}
