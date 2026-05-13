package com.iwhalecloud.byai.common.message.qo;

import lombok.Getter;
import lombok.Setter;

import java.util.Collection;

/**
 * @author he.duming
 * @date 2026-02-09 22:51:42
 * @description TODO
 */
@Getter
@Setter
public class AuAgentMetaPageQo {

    /**
     * 页码
     */
    private Integer pageNum = 1;

    /**
     * 页大小
     */
    private Integer pageSize = 10;

    /**
     * 元数据类型列表
     */
    private String metaType;

    /**
     * 元数据信息
     */
    private Collection<String> metaIdList;

    /**
     * 元数据类型列表
     */
    private Collection<String> metaTypeList;

    /**
     * 0：草稿，1发布，2上架，3已下架
     */
    private Integer metaStatus;

    /**
     * 0：草稿，1发布，2上架，3已下架
     */
    private Collection<Integer> metaStatusList;

}
