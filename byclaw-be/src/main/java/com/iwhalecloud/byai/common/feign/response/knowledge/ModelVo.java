package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;

@Getter
@Setter
public class ModelVo {
    private List<Long> modelIds;
    private Integer pageIndex = 1;
    private Map<String, Object> params;
}
