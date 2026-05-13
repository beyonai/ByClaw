package com.iwhalecloud.byai.manager.vo.searchask;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-03-12 19:56:21
 * @description TODO
 */
@Getter
@Setter
public class SpaceKbResourceVo extends SpaceResourceVo {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long datasetId;
}
