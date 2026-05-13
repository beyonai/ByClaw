package com.iwhalecloud.byai.manager.domain.source.service;

import com.iwhalecloud.byai.manager.entity.source.SystemQo;
import java.util.List;

import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.mapper.source.SourceSystemMapper;
import com.iwhalecloud.byai.manager.entity.source.SourceSystem;

/**
 * @author he.duming
 * @date 2025-05-29 17:15:56
 * @description TODO
 */
@Service
public class SourceSystemService {

    @Autowired
    private SourceSystemMapper sSourceSystemMapper;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    /**
     * 查询系统配置信息
     * 
     * @param systemCode 系统编码
     * @return SourceSystem
     */
    public SourceSystem findBySystemCode(String systemCode) {
        LambdaQueryWrapper<SourceSystem> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SourceSystem::getSystemCode, systemCode);
        return sSourceSystemMapper.selectOne(queryWrapper);
    }

    public List<SourceSystem> getSourceSystemList() {
        return sSourceSystemMapper.getSourceSystemList();
    }

    /**
     * 根据appKey查询OAuth2配置
     * 
     * @param appKey OAuth2客户端ID
     * @return SourceSystem
     */
    public SourceSystem getSourceSystemByAppKey(String appKey) {
        LambdaQueryWrapper<SourceSystem> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SourceSystem::getAppKey, appKey);
        queryWrapper.eq(SourceSystem::getEnabled, "Y");
        return sSourceSystemMapper.selectOne(queryWrapper);
    }

    public List<SourceSystem> getSourceSystemListByTypes(SystemQo systemQo) {
        List<SourceSystem> result = ssResourceMapper.getSourceSystemListByTypes(systemQo);
        return result;
    }

}
