package com.iwhalecloud.byai.manager.entity.contract;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-09-26 14:33:02
 * @description TODO
 */
@Getter
@Setter
public class ContractChunkData {

    private Long docId;

    private Long pageNum;

    private Long chunkId;

    private String headingChain;

    private String content;

    private String url;

    private String description;

}

