package com.iwhalecloud.byai.state.domain.assitsant.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.superassist.SsSuperassistKwCatalog;
import com.iwhalecloud.byai.manager.mapper.superassist.SsSuperassistKwCatalogMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-04-21 17:03:42
 * @description 文档库关联目录
 */

@Service
public class SsSuperAssistKwCatalogService {

    @Autowired
    private SsSuperassistKwCatalogMapper ssSuperassistKwCatalogMapper;

    @Autowired
    private SequenceService sequenceService;

    /**
     * 新增助手目录
     *
     * @param ssSuperassistKwCatalog 超级助手目录
     */
    public void save(SsSuperassistKwCatalog ssSuperassistKwCatalog) {
        ssSuperassistKwCatalogMapper.insert(ssSuperassistKwCatalog);
    }

    /**
     * 三个特殊的会话,每个用户只有一个
     *
     * @param sessionType 会话类型
     * @param userId 用户标识
     * @return SsSuperassistKwCatalog
     */
    public SsSuperassistKwCatalog findBySessionType(String sessionType, Long userId) {

        LambdaQueryWrapper<SsSuperassistKwCatalog> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsSuperassistKwCatalog::getSessionType, sessionType);
        queryWrapper.eq(SsSuperassistKwCatalog::getSuperassistId, userId);
        List<SsSuperassistKwCatalog> ssSuperassistKwCatalogs = ssSuperassistKwCatalogMapper.selectList(queryWrapper);

        // 不为空返回第1条
        return !ssSuperassistKwCatalogs.isEmpty() ? ssSuperassistKwCatalogs.get(0) : null;
    }

    /**
     * 根据sessionId查找目录信息
     *
     * @param sessionId 会话标识
     * @param sessionType 会话类型
     * @param superassistId 用户标识
     * @return SsSuperassistKwCatalog
     */
    public SsSuperassistKwCatalog findSessionCatalog(Long sessionId, String sessionType, Long superassistId) {
        LambdaQueryWrapper<SsSuperassistKwCatalog> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsSuperassistKwCatalog::getSessionId, sessionId);
        queryWrapper.eq(SsSuperassistKwCatalog::getSessionType, sessionType);
        queryWrapper.eq(SsSuperassistKwCatalog::getSuperassistId, superassistId);
        return ssSuperassistKwCatalogMapper.selectOne(queryWrapper);
    }

    /**
     * 创建会话目录
     *
     * @param sessionId 会话标识
     * @param sessionType 会话类型
     * @param superassistId 超级助手标识
     * @param catalogId 目录标识
     * @param sessionDatasetId 知识库标识
     * @return SsSuperassistKwCatalog
     */
    public SsSuperassistKwCatalog createSessionCatalog(Long sessionId, String sessionType, Long superassistId,
        Long catalogId, Long sessionDatasetId) {
        SsSuperassistKwCatalog ssSuperassistKwCatalog = new SsSuperassistKwCatalog();
        ssSuperassistKwCatalog.setCatalogId(sequenceService.nextVal());
        ssSuperassistKwCatalog.setSuperassistId(superassistId);
        ssSuperassistKwCatalog.setSessionId(sessionId);
        ssSuperassistKwCatalog.setSessionType(sessionType);
        ssSuperassistKwCatalog.setCatalogId(catalogId);
        ssSuperassistKwCatalog.setSessionDatasetid(sessionDatasetId);
        ssSuperassistKwCatalog.setCreateUser(CurrentUserHolder.getCurrentUserId());
        ssSuperassistKwCatalog.setCreateTime(new Date());
        ssSuperassistKwCatalog.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        ssSuperassistKwCatalogMapper.insert(ssSuperassistKwCatalog);
        return ssSuperassistKwCatalog;

    }


}
