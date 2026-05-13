package com.iwhalecloud.byai.manager.qo.resource;


import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源发布目录表实体类
 */
@Setter
@Getter
public class CatalogDto {
    
    /**
     * 数字资源标识
     */
    private Long catalogId;

    private Boolean isQueryParent = true;

    /**
     * 资源名称
     */
    private String catalogName;

    /**
     * 资源描述
     */
    private String catalogDesc;

    /**
     * 父目录标识
     */
    @JsonProperty("pCatalogId")
    private Long pCatalogId;

    /**
     * 目录类型，6-领域  7-要素
     */
    private Integer catalogType;

    /**
     * 父目录名称
     */
    private String pCatalogName;

    /**
     * 资源类型
     */
    private List<String> resourceBizTypeList;

    private List<Integer> resourceStatusList;

    private String shelfTime;

    private String publishTime;

    private String keyword;

    private Integer pageIndex;

    private Integer pageSize;


    @Min(value = 1, message = "排序索引最小值为1")
    @Max(value = 9999, message = "排序索引最大值为9999")
    private Integer orderIndex;

    
}

