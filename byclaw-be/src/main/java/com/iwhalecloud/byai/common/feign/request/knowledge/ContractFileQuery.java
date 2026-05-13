package com.iwhalecloud.byai.common.feign.request.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-09-25 17:36:30
 * @description TODO
 */
@Getter
@Setter
public class ContractFileQuery extends FileQuery {

    /**
     * 更多过滤条件
     */
    private ContractMetadataFilter contract_metadata_filter;

    private List<Long> resourceIds;

}
