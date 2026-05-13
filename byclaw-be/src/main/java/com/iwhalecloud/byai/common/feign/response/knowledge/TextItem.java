package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class TextItem {
    private double score;

    private Data data;
}