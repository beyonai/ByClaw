package com.iwhalecloud.byai.manager.dto.digitemploy;

import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 数字员工安装知识或资源入参。
 */
@Getter
@Setter
public class DigitalEmployeeInstallResourceDTO {

    /**
     * 数字员工资源ID。
     */
    private Long digitalEmployeeId;

    /**
     * 待绑定的知识或资源ID列表。
     */
    private List<Long> relIds;
}
