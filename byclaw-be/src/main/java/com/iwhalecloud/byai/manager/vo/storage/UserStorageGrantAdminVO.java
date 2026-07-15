package com.iwhalecloud.byai.manager.vo.storage;

import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UserStorageGrantAdminVO {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long grantId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long userId;

    private String userCode;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long packageId;

    private String packageCode;

    private String packageName;

    private Long grantedBytes;

    private String grantStatus;

    private String grantSource;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long grantedBy;

    private String grantedByCode;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date grantedTime;

    private String remark;
}
