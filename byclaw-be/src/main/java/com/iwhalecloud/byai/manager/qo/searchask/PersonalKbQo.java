package com.iwhalecloud.byai.manager.qo.searchask;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-03-11 11:32:51
 * @description TODO
 */
@Getter
@Setter
public class PersonalKbQo {

    private int pageNum;

    private int pageSize;

    private Long sessionId;

    private Long createBy;

    private String keyword;

}
