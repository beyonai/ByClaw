package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.manager.entity.resource.SsResExtObject;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

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
}
