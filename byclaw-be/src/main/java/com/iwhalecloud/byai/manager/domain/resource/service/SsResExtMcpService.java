package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtMcpMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * MCP扩展服务
 */
@Service
public class SsResExtMcpService {

    @Autowired
    private SsResExtMcpMapper ssResExtMcpMapper;

    public void save(SsResExtMcp ssResExtMcp) {
        ssResExtMcpMapper.insert(ssResExtMcp);
    }

    public void update(SsResExtMcp ssResExtMcp) {
        ssResExtMcpMapper.updateById(ssResExtMcp);
    }

    public void removeById(Long resourceId) {
        ssResExtMcpMapper.deleteById(resourceId);
    }

    public SsResExtMcp findById(Long resourceId) {
        return ssResExtMcpMapper.selectById(resourceId);
    }
}
