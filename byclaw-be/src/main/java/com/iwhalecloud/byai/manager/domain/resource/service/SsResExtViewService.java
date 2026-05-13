package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.manager.entity.resource.SsResExtView;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtViewMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

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
}
