package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class Data {
    private long document_id;

    private String documentName;

    private String heading_chain;

    private long chunk_id;

    private double score;

    private String content;

    private long doc_id;

    private String type;

    private String url;

}