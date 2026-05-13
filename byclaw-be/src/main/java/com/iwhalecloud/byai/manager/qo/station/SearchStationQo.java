package com.iwhalecloud.byai.manager.qo.station;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SearchStationQo {

    /**
     * 查询驻地标识，不允许为空
     */
    @NotNull(message = "{searchstationqo.stationid.notnull}")
    private Long stationId;

}
