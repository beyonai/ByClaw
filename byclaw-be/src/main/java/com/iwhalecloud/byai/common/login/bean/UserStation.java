package com.iwhalecloud.byai.common.login.bean;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

@Getter
@Setter
public class UserStation implements Serializable {
    private Long stationId;

    private Long pStationId;

    private String stationName;

    private Integer stationType;
    /**
     * 驻地标识路径
     */
    private String stationIdPath;

    /**
     * 是否国外驻地:0：否，1：是
     */
    private Integer isAbroad;




}
