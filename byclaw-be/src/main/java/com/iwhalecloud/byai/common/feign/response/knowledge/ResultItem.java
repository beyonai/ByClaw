package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Setter
@Getter
public class ResultItem {
    private List<TextItem> text;
}