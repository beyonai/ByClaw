package com.iwhalecloud.byai.manager.vo.digitemploy;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源安装目标数字员工。
 *
 * @author qin.guoquan
 * @date 202-09-03 20:38:38
 */
@Getter
@Setter
public class DigitalEmployeeInstallTargetVo {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    private String resourceName;

    private String resourceDesc;

    private String ownerType;

    private String avatar;

    private Boolean installed;
}
