package com.iwhalecloud.byai.state.domain.resource.qo;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-03-30 14:03:50
 * @description TODO
 */
@Getter
@Setter
public class DatasetQo extends QueryObject {

    private Long createBy;

    /** 知识库列表等调用方按资源业务类型筛选，空值时保持历史全量查询行为。 */
    private List<String> resourceBizTypeList;
}
