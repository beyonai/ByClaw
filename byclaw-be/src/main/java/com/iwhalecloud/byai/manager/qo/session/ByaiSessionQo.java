package com.iwhalecloud.byai.manager.qo.session;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-02-14 09:34:07
 * @description TODO
 */
@Getter
@Setter
public class ByaiSessionQo {

    private Integer pageNum = 1;

    private Integer pageSize = 10;

    private String searchKeyword;

    /**
     * 创建人
     */
    private Long creatorId;

    /**
     * 企业标识
     */
    private Long enterpriseId;

    /**
     * 类型
     */
    private String objectType;

    /**
     * 对象值
     */
    private Long objectId;

    /**
     * 0表示非调试，1表示调试
     */
    private Integer isDebug = 0;

    private List<String> sessionType;

}
