package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.manager.dto.resource.ResourceExtMcpDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcpServer;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtMcpServerMapper;
import com.iwhalecloud.byai.common.util.ListUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * @author he.duming
 * @date 2025-09-07 19:53:27
 * @description TODO
 */
@Service
public class SsResExtMcpServerService {

    @Autowired
    private SsResExtMcpServerMapper ssResExtMcpServerMapper;

    /**
     * 插入MCP服务扩展表
     *
     * @param ssResExtMcpServer MCP服务扩展
     */
    public void save(SsResExtMcpServer ssResExtMcpServer) {
        ssResExtMcpServerMapper.insert(ssResExtMcpServer);
    }

    /**
     * 更新MCP服务扩展表
     *
     * @param ssResExtMcpServer MCP服务扩展
     */
    public void update(SsResExtMcpServer ssResExtMcpServer) {
        ssResExtMcpServerMapper.updateById(ssResExtMcpServer);
    }

    /**
     * 查询资源信息
     *
     * @param resourceId 资源扩展标识
     */
    public SsResExtMcpServer findById(Long resourceId) {
        return ssResExtMcpServerMapper.selectById(resourceId);
    }

    /**
     * 查询MCP服务信息
     *
     * @param resourceIds 资源标识
     * @return ResourceExtMcpDto
     */
    public List<ResourceExtMcpDto> findResourceExtMcpByIds(Collection<Long> resourceIds) {
        return ssResExtMcpServerMapper.findResourceExtMcpByIds(resourceIds);
    }

    /**
     * 查询单个值
     *
     * @param resourceId 资源标识
     * @return ResourceExtMcpDto
     */
    public ResourceExtMcpDto findResourceExtMcpById(Long resourceId) {
        Set<Long> resourceIds = Collections.singleton(resourceId);
        List<ResourceExtMcpDto> resultList = this.findResourceExtMcpByIds(resourceIds);
        return ListUtil.isNotEmpty(resultList) ? resultList.get(0) : null;
    }
}
