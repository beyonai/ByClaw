package com.iwhalecloud.byai.common.message.pojo;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

/**
 * @Author he.duming
 * @since 2026-02-03
 * @Version 1.0
 * @Description 描述
 */
@Getter
@Setter
public class DeleteByQuery implements Serializable {

    private String indexName;

    public DeleteByQuery(String indexName) {
        this.indexName = indexName;
    }
}