package com.iwhalecloud.byai.manager.infrastructure.embedding.request;

import java.util.List;

import lombok.Data;

/**
 * @description:
 * @author: cxf
 * @create: 2023-11-30 17:22
 **/
@Data
public class CallMaasEmbeddingQo {

    private String model = "bce-embedding-base_v1";

    private List<EmbeddingData> data;

    @Data
    public static class EmbeddingData {
        private Integer id;

        private String content;
    }
}
