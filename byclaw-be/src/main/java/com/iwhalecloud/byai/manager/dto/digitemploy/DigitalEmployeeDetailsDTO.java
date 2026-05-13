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
     * 关联技能标识列表
     */
    private List<String> relSkills;

    /**
     * 记忆配置列表（规则名称、规则内容）
     */
    private List<MemoryConfigDTO> memoryConfigList;

}
