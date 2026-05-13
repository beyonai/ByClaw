package com.iwhalecloud.byai.state.domain.assitsant.service;

import com.iwhalecloud.byai.state.domain.assitsant.vo.ResourcePrivilegeRequestDto;
import com.iwhalecloud.byai.state.domain.assitsant.vo.ResourcePrivilegeQueryResponseDto;

import java.util.List;

/**
 * 资源授权服务接口
 */
public interface ResourcePrivilegeService {
    
    /**
     * 保存助理资源授权信息
     * 支持新增和修改数据
     * 
     * @param requestDto 请求参数
     * @return 操作结果
     */
    boolean saveResourcePrivilege(ResourcePrivilegeRequestDto requestDto);
    
        /**
     * 查询用户资源权限
     * 优先查询新表，如果新表无记录则查询旧表作为默认权限
     *
     * @param userId 用户ID
     * @param privilegeType 授权类型：INNER-内部授权，OUTER-外部授权
     * @param resourceType 资源类型：KG_DB-知识库，KG_DOC-文档库，KG_QA-问答库，KG_TERM-术语库
     * @return 资源权限列表
     */
    List<ResourcePrivilegeQueryResponseDto> getUserResourcePrivileges(Long userId, String privilegeType, String resourceType);
    
    /**
     * 批量查询用户资源权限
     * 支持同时查询多种权限类型和资源类型
     *
     * @param userId 用户ID
     * @param privilegeTypes 授权类型列表：INNER-内部授权，OUTER-外部授权，如果为空则查询所有类型
     * @param resourceTypes 资源类型列表：KNOWLEDGE_BASE-知识库，DATA_BASE-数据库，如果为空则查询所有类型
     * @return 资源权限列表
     */
    List<ResourcePrivilegeQueryResponseDto> getUserResourcePrivilegesBatch(Long userId, List<String> privilegeTypes, List<String> resourceTypes);
    
    /**
     * 批量查询用户默认资源权限
     * 查询通用权限授权表中的默认权限
     * 支持同时查询多种权限类型和资源类型
     *
     * @param userId 用户ID
     * @param privilegeTypes 授权类型列表：INNER-内部授权，OUTER-外部授权，如果为空则查询所有类型
     * @param resourceTypes 资源类型列表：KNOWLEDGE_BASE-知识库，DATA_BASE-数据库，如果为空则查询所有类型
     * @return 默认资源权限列表
     */
    List<ResourcePrivilegeQueryResponseDto> getUserDefaultResourcePrivilegesBatch(Long userId, List<String> privilegeTypes, List<String> resourceTypes);
}
