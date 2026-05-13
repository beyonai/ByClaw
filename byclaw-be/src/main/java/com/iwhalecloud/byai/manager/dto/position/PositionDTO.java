package com.iwhalecloud.byai.manager.dto.position;

import lombok.Data;

@Data
public class PositionDTO {

    /**
     * 岗位编码
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
     * 岗位负责人名称
     */
    private String headerName;

}
