package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcpTool;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtMcpToolMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-09-07 19:53:59
 * @description TODO
 */
@Service
public class SsResExtMcpToolService {

    @Autowired
    private SsResExtMcpToolMapper ssResExtMcpToolMapper;

    /**
     * 插入MCP服务工具扩展表
     *
     * @param ssResExtMcpTool MCP服务工具扩展
     */
    public void save(SsResExtMcpTool ssResExtMcpTool) {
        ssResExtMcpToolMapper.insert(ssResExtMcpTool);
    }

    /**
     * 更新MCP服务工具扩展表
     *
     * @param ssResExtMcpTool MCP服务工具扩展
     */
    public void update(SsResExtMcpTool ssResExtMcpTool) {
        ssResExtMcpToolMapper.updateById(ssResExtMcpTool);
    }

    /**
     * 查询资源信息
     *
     * @param resourceId 资源扩展标识
     */
    public SsResExtMcpTool findById(Long resourceId) {
        return ssResExtMcpToolMapper.selectById(resourceId);
    }
}
