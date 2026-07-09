package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.manager.entity.resource.SsResExtView;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtViewMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;

/**
 * add by qin.guoquan 2026-04-10
 * 视图扩展服务
 */
@Service
public class SsResExtViewService {

    @Autowired
    private SsResExtViewMapper ssResExtViewMapper;

    public void save(SsResExtView ssResExtView) {
        ssResExtViewMapper.insert(ssResExtView);
    }

    public void update(SsResExtView ssResExtView) {
        ssResExtViewMapper.updateById(ssResExtView);
    }

    public void removeById(Long resourceId) {
        ssResExtViewMapper.deleteById(resourceId);
    }

    public SsResExtView findById(Long resourceId) {
        return ssResExtViewMapper.selectById(resourceId);
    }

    /**
     * PR-3 (#150) 批量查询视图扩展数据. 单 SQL IN 子句,替代循环 findById.
     *
     * @param resourceIds 资源ID集合(空集合/null 时返回空 List,不触发 SQL)
     * @return 视图扩展列表
     */
    public List<SsResExtView> findByIds(Collection<Long> resourceIds) {
        return ssResExtViewMapper.findByIds(resourceIds);
    }
}
