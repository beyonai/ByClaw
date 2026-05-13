package com.iwhalecloud.byai.manager.dto.position;

import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;
import java.util.List;

/**
 * 数字岗位DTO（包含领域信息）
 */
@Getter
@Setter
public class DigitalPositionDTO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 岗位ID
     */
    private Long positionId;

    /**
     * 岗位名称
     */
    private String positionName;

    /**
     * 岗位描述
     */
    private String positionDesc;

    /**
     * 是否为数字岗位 0 - 否 1 - 是
     */
    private Integer isDigitalPosition;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 更新时间
     */
    private Date updateTime;

    /**
     * 关联的领域列表
     */
    private List<CatalogInfo> catalogs;

    /**
     * 领域信息
     */
    @Getter
    @Setter
    public static class CatalogInfo implements Serializable {
        private Long catalogId;
        private String catalogName;
        private String catalogDesc;
    }
}
