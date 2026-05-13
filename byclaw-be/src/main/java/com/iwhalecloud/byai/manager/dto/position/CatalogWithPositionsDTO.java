package com.iwhalecloud.byai.manager.dto.position;

import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;

/**
 * 领域及其关联岗位DTO
 */
@Getter
@Setter
public class CatalogWithPositionsDTO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 领域ID
     */
    private Long catalogId;

    /**
     * 领域名称
     */
    private String catalogName;

    /**
     * 领域描述
     */
    private String catalogDesc;

    /**
     * 该领域下的岗位列表
     */
    private List<PositionInfo> positions;

    /**
     * 岗位信息
     */
    @Getter
    @Setter
    public static class PositionInfo implements Serializable {
        private Long positionId;
        private String positionName;
        private String positionDesc;
        private Integer isDigitalPosition;
    }
}
