package com.iwhalecloud.byai.manager.dto.digitemploy;

import com.alibaba.fastjson.JSONObject;
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
     * 记忆配置列表（规则名称、规则内容）
     */
    private List<MemoryConfigDTO> memoryConfigList;

    /**
     * 已绑定的本体明细：数组每项为一个「选中叶子」的扁平路径描述
     * （resourceId、ontologyBaseCode、resourceName [+ sceneId/sceneName][+ viewCode/viewName][+ objectCode/objectName]）。
     * 由已绑定的本体类资源与 ss_res_ext_ontology 元数据重建，随 relIds 派生刷新。
     */
    private List<JSONObject> relOntology;

}

