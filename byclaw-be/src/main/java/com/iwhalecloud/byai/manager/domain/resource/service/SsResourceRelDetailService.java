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

    void removeAllByResourceIdOrRelResourceId(Long resourceId);

    /**
     * 查询数字员工关联的技能列表（用于 OpenAPI） 返回技能资源基础字段（resourceId、resourceCode、resourceName、resourceDesc、resourceBizType）
     * 及对应子表扩展数据（extDoc/extTool/extToolKit/extDbDatasets）
     *
     * @param resourceId 数字员工资源ID
     * @return 技能列表
     */
    List<SsResourceRelDetailDTO> querySkillsForOpenApi(Long resourceId);

    List<SsResourceRelDetail> find(Long resourceId, Long relResourceId);

    /**
     * 统计某资源被多少条关系明细引用（跨所有数字员工），用于虚拟资源孤儿判断。
     *
     * @param relResourceId 被关联资源 ID
     * @return 引用条数
     */
    long countByRelResourceId(Long relResourceId);


    /**
     * 保存数据员工组关系
     *
     * @param resourceId    资源标识
     * @param relResourceId 关联数字员工
     * @param teamRole      角色
     * @param sortOrder     排序
     */
    SsResourceRelDetail saveDigEmployeeGroupRelDetail(Long resourceId, Long relResourceId, String teamRole, Integer sortOrder);

}
