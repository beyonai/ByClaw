package com.iwhalecloud.byai.manager.dto.digitemploy;

import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 批量向数字员工安装知识或资源入参。
 *
 * @author qin.guoquan
 * @date 202-09-03 20:38:38
 */
@Getter
@Setter
public class DigitalEmployeeBatchInstallResourceDTO {

    /**
     * 安装目标数字员工资源ID列表。
     */
    private List<Long> digitalEmployeeIds;

    /**
     * 待安装的知识或资源ID列表。
     */
    private List<Long> relIds;
}
