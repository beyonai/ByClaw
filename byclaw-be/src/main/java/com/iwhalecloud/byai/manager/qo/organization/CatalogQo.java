package com.iwhalecloud.byai.manager.qo.organization;


import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class CatalogQo {


    /**
     * 目录类型：1-智能体，2-文档，3-插件 4-数据库，5-MCP服务
     */
    private Integer catalogType;

    private String keyword;

    private Boolean containsParent;

    private List<Long> catalogIds = new ArrayList<>();

    public CatalogQo() {

    }

    public CatalogQo(List<Long> catalogIds) {
        this.catalogIds = catalogIds;
    }
}
