package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.manager.entity.resource.SsResExtObject;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;

/**
 * add by qin.guoquan 2026-04-10
 * 对象扩展服务
 */
@Service
public class SsResExtObjectService {

    @Autowired
    private SsResExtObjectMapper ssResExtObjectMapper;

    public void save(SsResExtObject ssResExtObject) {
        ssResExtObjectMapper.insert(ssResExtObject);
    }

    public void update(SsResExtObject ssResExtObject) {
        ssResExtObjectMapper.updateById(ssResExtObject);
    }

    public void removeById(Long resourceId) {
        ssResExtObjectMapper.deleteById(resourceId);
    }

    public SsResExtObject findById(Long resourceId) {
        return ssResExtObjectMapper.selectById(resourceId);
    }

    /**
     * PR-3 (#150) 批量查询对象扩展数据. 单 SQL IN 子句,替代循环 findById.
     *
     * @param resourceIds 资源ID集合(空集合/null 时返回空 List,不触发 SQL)
     * @return 对象扩展列表
     */
    public List<SsResExtObject> findByIds(Collection<Long> resourceIds) {
        return ssResExtObjectMapper.findByIds(resourceIds);
    }
}
