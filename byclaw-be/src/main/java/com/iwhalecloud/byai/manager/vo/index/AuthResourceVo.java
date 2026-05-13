package com.iwhalecloud.byai.manager.vo.index;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * @author he.duming
 * @date 2025-12-02 16:58:13
 * @description TODO
 */
@Getter
@Setter
public class AuthResourceVo {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceSourcePkId;

    private String resourceCode;

    private String resourceName;

    private String resourceDesc;

    private String resourceBizType;

    private Long createBy;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    private String manUserId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long manOrgId;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;
}
