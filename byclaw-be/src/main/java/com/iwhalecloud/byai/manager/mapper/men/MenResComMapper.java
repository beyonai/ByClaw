package com.iwhalecloud.byai.manager.mapper.men;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.men.MenResCom;
import com.iwhalecloud.byai.manager.qo.men.FixedMemoryQo;
import com.iwhalecloud.byai.manager.vo.men.FixedMemoryMemoryTaskVo;
import com.iwhalecloud.byai.manager.vo.men.MenTaskVo;
import java.util.List;

/**
 * 资源组件表Mapper
 *
 * @author system
 * @since 2024-1
 */
public interface MenResComMapper extends BaseMapper<MenResCom> {

    /**
     * 根据子任务查询父任务的卡片信息
     */
    MenResCom getParentResComBySubTaskExtId(MenTaskVo menTaskVo);

    /**
     * 根据条件查询固定记忆任务列表
     */
    List<FixedMemoryMemoryTaskVo> selectFixedMemoryMemoryTaskVoByQo(FixedMemoryQo fixedMemoryQo);
}