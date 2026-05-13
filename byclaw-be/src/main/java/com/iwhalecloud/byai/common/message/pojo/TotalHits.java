package com.iwhalecloud.byai.common.message.pojo;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

/**
 * 命中总数：总条数及与查询的关系（如 eq、gte）。
 *
 * @author he.duming
 * @since 2026-02-03
 */
@Getter
@Setter
public class TotalHits implements Serializable {

    private Long total = 0L;

    private String relation;

}