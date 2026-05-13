package com.iwhalecloud.byai.common.message.pojo;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * 搜索命中结果：命中列表、总命中数、聚合结果。
 *
 * @author he.duming
 * @since 2026-02-03
 */
@Getter
@Setter
public class SearchHits<T> implements Serializable {

    private List<T> searchHits;

    private TotalHits totalHits = new TotalHits();

    private Map<String, Object> aggregations = Collections.emptyMap();
}