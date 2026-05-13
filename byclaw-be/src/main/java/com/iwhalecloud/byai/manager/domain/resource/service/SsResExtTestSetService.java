package com.iwhalecloud.byai.manager.domain.resource.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTestSet;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtTestSetMapper;
import com.iwhalecloud.byai.manager.qo.resource.SsResExtTestSetQo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.resource.SsResExtTestSetVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 数字员工测试集上传临时表Service
 */
@Service
public class SsResExtTestSetService {

    @Autowired
    private SsResExtTestSetMapper ssResExtTestSetMapper;

    /**
     * 保存测试集记录
     *
     * @param testSet 测试集记录
     */
    public void save(SsResExtTestSet testSet) {
        ssResExtTestSetMapper.insert(testSet);
    }

    /**
     * 更新测试集记录
     *
     * @param testSet 测试集记录
     */
    public void update(SsResExtTestSet testSet) {
        ssResExtTestSetMapper.updateById(testSet);
    }

    /**
     * 根据ID查询测试集记录
     *
     * @param testSetId 测试集记录ID
     * @return SsResExtTestSet
     */
    public SsResExtTestSet findById(Long testSetId) {
        return ssResExtTestSetMapper.selectById(testSetId);
    }

    /**
     * 根据资源ID和批次ID查询测试集记录
     *
     * @param resourceId 数字员工资源ID
     * @param batchId 测试集批次ID
     * @return SsResExtTestSet 测试集记录，如果不存在返回null
     */
    public SsResExtTestSet findByResourceIdAndBatchId(Long resourceId, String batchId) {
        return ssResExtTestSetMapper.selectByResourceIdAndBatchId(resourceId, batchId);
    }

    /**
     * 根据资源ID查询最新的测试集记录
     *
     * @param resourceId 数字员工资源ID
     * @return SsResExtTestSet 最新的测试集记录，如果不存在返回null
     */
    public SsResExtTestSet findLatestByResourceId(Long resourceId) {
        return ssResExtTestSetMapper.selectLatestByResourceId(resourceId);
    }

    /**
     * 删除测试集记录
     *
     * @param testSetId 测试集记录ID
     */
    public void deleteById(Long testSetId) {
        ssResExtTestSetMapper.deleteById(testSetId);
    }

    /**
     * 保存或更新测试集记录
     * @param testSet 测试集记录
     */
    public void saveOrUpdate(SsResExtTestSet testSet) {
        if (testSet == null) {
            return;
        }
        if (testSet.getTestSetId() == null) {
            testSet.setCreateTime(LocalDateTime.now());
            testSet.setCreateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
            save(testSet);
            return;
        }
        testSet.setUpdateTime(LocalDateTime.now());
        update(testSet);
    }

    /**
     * 分页查询测试集记录
     *
     * @param testSetQo 查询对象
     * @return PageInfo&lt;SsResExtTestSetVo&gt;
     */
    public PageInfo<SsResExtTestSetVo> selectTestSetByQo(SsResExtTestSetQo testSetQo) {
        Page<SsResExtTestSetVo> page = new Page<>(testSetQo.getPageNum(), testSetQo.getPageSize());

        List<SsResExtTestSetVo> ssResExtTestSetVos = ssResExtTestSetMapper.selectTestSetByQo(page, testSetQo);
        page.setRecords(ssResExtTestSetVos); // 手动设置记录到Page对象中

        return PageHelperUtil.toPageInfo(page);
    }
}