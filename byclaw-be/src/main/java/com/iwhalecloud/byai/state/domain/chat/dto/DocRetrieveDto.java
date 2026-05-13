package com.iwhalecloud.byai.state.domain.chat.dto;


import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Setter
@Getter
public class DocRetrieveDto {

    /**
     * 用户输入的检索问题
     */
    @NotBlank(message = "{docretrievedto.query.notempty}")
    private String query;

    /**
     * 检索类型，当前支持"embedding、fullTextRecall、mixedRecall"。
     */
    @NotNull(message = "{docretrievedto.querytype.notempty}")
    private String query_type;

    /**
     * 返回结果数量，默认100
     */
    private Integer size;

    /**
     * 需要检索的数据集Id列表
     */
    @NotNull(message = "{docretrievedto.datasetids.notempty}")
    private List<Long> dataset_ids;

    /**
     * 环境变量配置
     */
    private Object env;

}
