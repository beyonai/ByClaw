package com.iwhalecloud.byai.manager.qo.station;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.Collection;

/**
 * @date 2025-01-08
 * @description 查询驻地树对象查询
 */
@Getter
@Setter
public class StationTreeQo {

    /**
     * 是否需要根据父驻地标识过滤
     */
    @Min(value = -1, message = "{stationtreeqo.parentid.min}")
    private Long parentStationId;

    /**
     * 关键字搜索
     */
    @Size(max = 100, message = "{stationtreeqo.keyword.size}")
    private String keyword;

    /**
     * 模糊搜索时是否查询父节点返回
     */
    private boolean containsParent;

    /**
     * 根据驻地标识查询
     */
    private Collection<Long> stationIds;

    /**
     * 驻地类型：1:国家，2:省级，3:城市
     */
    private Integer stationType;

    /**
     * 是否国外驻地：0：否，1：是
     */
    private Integer isAbroad;


    public StationTreeQo() {
    }

    public StationTreeQo(Collection<Long> stationIds) {
        this.stationIds = stationIds;
    }
}
