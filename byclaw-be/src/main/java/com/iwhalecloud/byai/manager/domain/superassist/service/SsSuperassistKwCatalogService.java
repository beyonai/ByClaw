package com.iwhalecloud.byai.manager.domain.superassist.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.superassist.SsSuperassistKwCatalog;
import com.iwhalecloud.byai.manager.mapper.superassist.SsSuperassistKwCatalogMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;

import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.Date;

/**
 * @author he.duming
 * @date 2025-05-19 16:27:26
 * @description TODO
 */
@Service
public class SsSuperassistKwCatalogService {

    @Autowired
    private SsSuperassistKwCatalogMapper ssSuperassistKwCatalogMapper;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 保存知识库会话目录
     *
     * @param ssSuperassistKwCatalog 目录信息
     */
    public void save(SsSuperassistKwCatalog ssSuperassistKwCatalog) {
        ssSuperassistKwCatalog.setKwCatalogId(SequenceService.nextVal());
        ssSuperassistKwCatalog.setCreateTime(new Date());
        ssSuperassistKwCatalog.setCreateUser(CurrentUserHolder.getCurrentUserId());
        ssSuperassistKwCatalogMapper.insert(ssSuperassistKwCatalog);
    }

    /**
     * 移除超级助手标识
     *
     * @param superassistId 超级助手
     */
    public void remove(Long superassistId) {
        if (superassistId == null) {
            return;
        }
        LambdaQueryWrapper<SsSuperassistKwCatalog> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsSuperassistKwCatalog::getSuperassistId, superassistId);
        ssSuperassistKwCatalogMapper.delete(queryWrapper);
    }
}
