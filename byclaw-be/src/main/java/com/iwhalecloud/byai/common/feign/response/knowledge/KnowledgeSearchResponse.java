package com.iwhalecloud.byai.common.feign.response.knowledge;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class KnowledgeSearchResponse {

    private List<ResultItem> result;

    private String message;

    private int code;

}
