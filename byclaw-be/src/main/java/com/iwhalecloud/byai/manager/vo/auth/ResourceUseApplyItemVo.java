package com.iwhalecloud.byai.manager.vo.auth;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 资源使用申请审核列表项。
 * @author qin.guoquan
 * @date 2026-04-25 16:20:00
 */
@Getter
@Setter
public class ResourceUseApplyItemVo {

    /**
     * 申请记录标识。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long privilegeGrantId;

    /**
     * 申请用户标识。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long userId;

    /**
     * 申请用户名。
     */
    private String userName;

    /**
     * 申请时间。
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date applyTime;

    /**
     * 申请状态。
     */
    private String applyStatus;
}
