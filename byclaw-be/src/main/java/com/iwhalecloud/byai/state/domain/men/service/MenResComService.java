package com.iwhalecloud.byai.state.domain.men.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.men.MenResCom;
import com.iwhalecloud.byai.manager.vo.men.MenTaskVo;
import com.iwhalecloud.byai.manager.mapper.men.MenResComMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.Date;
import java.util.List;

/**
 * 资源组件服务
 */
@Service
public class MenResComService {
    @Autowired
    private MenResComMapper menResComMapper;

    @Autowired
    private SequenceService sequenceService;

    /**
     * 保存组件
     *
     * @param menResCom 保存
     */
    public void save(MenResCom menResCom) {
        menResComMapper.insert(menResCom);
    }

    /**
     * 删除组件
     *
     * @param resComId 组件标识
     */
    public void deleteById(Long resComId) {
        menResComMapper.deleteById(resComId);
    }

    /**
     * 查询组件
     *
     * @param resComId 组件标识
     */
    public MenResCom findByResComId(Long resComId) {
        return menResComMapper.selectById(resComId);
    }

    /**
     * 新增资源组件
     *
     * @param resCom 资源组件信息
     * @return 资源组件信息
     */
    public MenResCom insertResCom(MenResCom resCom) {
        // 资源组件
        resCom.setResComId(sequenceService.nextVal());
        resCom.setCreateBy(CurrentUserHolder.getCurrentUserId());
        resCom.setCreateTime(new Date());
        resCom.setComAcctId(CurrentUserHolder.getEnterpriseId());
        menResComMapper.insert(resCom);
        return resCom;
    }

    /**
     * 根据ID查询资源组件
     *
     * @param resComId 资源组件标识
     * @return 资源组件信息
     */
    public MenResCom getRecCom(Long resComId) {
        // 资源组件
        return menResComMapper.selectById(resComId);
    }

    /**
     * 根据ID列表批量查询资源组件
     *
     * @param resComIds 资源组件ID列表
     * @return 资源组件列表
     */
    public List<MenResCom> getResComBatch(List<Long> resComIds) {
        LambdaQueryWrapper<MenResCom> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(MenResCom::getResComId, resComIds);
        return menResComMapper.selectList(queryWrapper);
    }

    public MenResCom updateResCom(MenResCom menResCom) {
        menResCom.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        menResCom.setUpdateTime(new Date());
        menResComMapper.updateById(menResCom);
        return menResCom;
    }

    /**
     * 根据子任务扩展ID查询父资源组件
     *
     * @param menTaskVo 任务信息
     * @return 父资源组件信息
     */
    public MenResCom getParentResComBySubTaskExtId(MenTaskVo menTaskVo) {
        return menResComMapper.getParentResComBySubTaskExtId(menTaskVo);
    }

}
