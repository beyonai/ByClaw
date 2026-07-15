package com.iwhalecloud.byai.manager.vo.storage;

import java.util.List;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UserStorageDowngradePreviewVO {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long grantId;

    private List<String> grantIds;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long userId;

    private String userCode;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long packageId;

    private String packageCode;

    private String packageName;

    private String packageNames;

    private Integer selectedGrantCount;

    private String grantSource;

    private Long grantedBytes;

    private Long beforeQuotaBytes;

    private Long targetQuotaBytes;

    private Long usedBytes;

    private Long reservedBytes;

    private Long overageBytes;

    private Boolean overQuotaAfterDowngrade;

    private Boolean hasOpenRequest;

    private Integer graceDays;
}
