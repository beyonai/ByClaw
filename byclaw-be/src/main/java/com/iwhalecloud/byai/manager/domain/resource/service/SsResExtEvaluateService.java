package com.iwhalecloud.byai.manager.domain.resource.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtEvaluate;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtEvaluateMapper;
import com.iwhalecloud.byai.manager.qo.resource.SsResExtEvaluateQO;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 数字员工评估旧数据表Service
 */
@Service
public class SsResExtEvaluateService {

    @Autowired
    private SsResExtEvaluateMapper ssResExtEvaluateMapper;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 根据资源ID查询评估时间最新的记录
     *
     * @param resourceId 数字员工资源ID
     * @return SsResExtEvaluate 最新的评估记录，如果不存在返回null
     */
    public SsResExtEvaluate findLatestByResourceId(Long resourceId) {
        if (resourceId == null) {
            return null;
        }
        return ssResExtEvaluateMapper.selectLatestByResourceId(resourceId);
    }

    /**
     * 保存评估记录
     *
     * @param evaluate 评估记录
     */
    public void save(SsResExtEvaluate evaluate) {
        evaluate.setEvaluateId(SequenceService.nextVal());
        ssResExtEvaluateMapper.insert(evaluate);
    }

    /**
     * 更新评估记录
     *
     * @param evaluate 评估记录
     */
    public void update(SsResExtEvaluate evaluate) {
        ssResExtEvaluateMapper.updateById(evaluate);
    }

    /**
     * 根据ID查询评估记录
     *
     * @param evaluateId 评估记录ID
     * @return SsResExtEvaluate
     */
    public SsResExtEvaluate findById(Long evaluateId) {
        return ssResExtEvaluateMapper.selectById(evaluateId);
    }

    /**
     * 删除评估记录
     *
     * @param evaluateId 评估记录ID
     */
    public void deleteById(Long evaluateId) {
        ssResExtEvaluateMapper.deleteById(evaluateId);
    }

    /**
     * 保存或更新评估记录
     * @param ssResExtEvaluate 评估记录
     */
    public void saveOrUpdate(SsResExtEvaluate ssResExtEvaluate) {
        if (ssResExtEvaluate == null) {
            return;
        }
        if (ssResExtEvaluate.getEvaluateId() == null) {
            save(ssResExtEvaluate);
            return;
        }
        update(ssResExtEvaluate);
    }

    /**
     * 分页查询数字员工评估结果
     *
     * @param qo 查询条件
     * @return PageInfo&lt;SsResExtEvaluate&gt; 分页评估结果
     */
    public PageInfo<SsResExtEvaluate> selectEvaluateByPage(SsResExtEvaluateQO qo) {
        Page<SsResExtEvaluate> page = new Page<>(qo.getPageNum(), qo.getPageSize());
        page = ssResExtEvaluateMapper.selectPageByQO(page, qo);
        return PageHelperUtil.toPageInfo(page);
    }
}
