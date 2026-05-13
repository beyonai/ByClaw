package com.iwhalecloud.byai.common.feign.request.knowledge;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-12-15 17:55:50
 * @description TODO
 */
@Getter
@Setter
public class ChunkFileQuery extends FileQuery {
    /**
     * 更多过滤条件
     */
    private ChunkMetadataFilter contract_metadata_filter;

    /**
     * 扩展属性
     */
    private ExtensionsOptions extensionsOptions;
}
