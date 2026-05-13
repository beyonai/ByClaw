package com.iwhalecloud.byai.manager.domain.resource.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.iwhalecloud.byai.manager.dto.resource.SsResourceRelDetailDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import java.util.List;

/**
 * 资源关联明细表Service接口
 */
public interface SsResourceRelDetailService extends IService<SsResourceRelDetail> {

    List<SsResourceRelDetail> findByResourceId(Long resourceId);

    /**
     * 查询数字员工关联的技能列表（用于 OpenAPI） 返回技能资源基础字段（resourceId、resourceCode、resourceName、resourceDesc、resourceBizType）
     * 及对应子表扩展数据（extDoc/extTool/extToolKit/extDbDatasets）
     *
     * @param resourceId 数字员工资源ID
     * @return 技能列表
     */
    List<SsResourceRelDetailDTO> querySkillsForOpenApi(Long resourceId);

}
