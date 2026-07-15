package com.iwhalecloud.byai.manager.vo.storage;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class StoragePackageSummaryVO {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long packageId;

    private String packageCode;

    private String packageName;

    private Long addonBytes;

    private Integer quantity;

    private Long totalGrantedBytes;
}
