package com.iwhalecloud.byai.manager.dto.digitemploy;

import com.iwhalecloud.byai.manager.dto.template.MemoryConfigDTO;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-10-31 01:25:17
 * @description TODO
 */

@Getter
@Setter
public class DigitalEmployeeDetailsDTO extends DigitalEmployeeDTO {

    /** 当前在用的数字员工组配置版本；普通数字员工不返回。 */
    private String configVersion;

    /**
     * 发布组织
     */
    private Long manOrgId;

    /**
     * 发布用户标识
     */
    private String manUserId;

    /**
     * 详情关联资源标识
     */
    private List<SsResourceDTO> relResourceList;

    /**
     * 记忆配置列表（规则名称、规则内容）
     */
    private List<MemoryConfigDTO> memoryConfigList;

}
