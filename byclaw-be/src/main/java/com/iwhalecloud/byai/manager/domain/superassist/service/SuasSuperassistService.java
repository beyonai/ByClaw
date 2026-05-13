package com.iwhalecloud.byai.manager.domain.superassist.service;

import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.mapper.superassist.SuasSuperassistMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;

/**
 * @author he.duming
 * @date 2025-05-06 22:16:00
 * @description TODO
 */
@Service
public class SuasSuperassistService {

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private SuasSuperassistMapper suasSuperassistMapper;

    /**
     * 查询用户的超级助手
     *
     * @param superassistId 用户标识
     * @return SuasSuperassist
     */
    public SuasSuperassist findById(Long superassistId) {
        return suasSuperassistMapper.selectById(superassistId);
    }

    /**
     * 查询用户的超级助手
     *
     * @param userId 用户标识
     * @return SuasSuperassist
     */
    public SuasSuperassist findByUserId(Long userId) {
        return suasSuperassistMapper.selectById(userId);
    }

    /**
     * 新增数据员工超级助手
     *
     * @param suasSuperassist 直级助手信息
     */
    public void addSuasSuperassist(SuasSuperassist suasSuperassist) {
        suasSuperassist.setCreateTime(new Date());
        suasSuperassist.setCreateUser(CurrentUserHolder.getCurrentUserId());
        suasSuperassist.setComAcctId(CurrentUserHolder.getEnterpriseId());
        suasSuperassistMapper.insert(suasSuperassist);
    }

    /**
     * 更新数据员工超级助手
     *
     * @param suasSuperassist 直级助手信息
     */
    public int updateById(SuasSuperassist suasSuperassist) {
        return suasSuperassistMapper.updateById(suasSuperassist);
    }

    /**
     * 移除超级助手标识
     *
     * @param superassistId 超级助手
     */
    public void remove(Long superassistId) {
        suasSuperassistMapper.deleteById(superassistId);
    }

    /**
     * 创建超级助手
     *
     * @param name 名称
     * @param intro 描述
     * @param datasetId 知识库标识
     * @return SuasSuperassist
     */
    public SuasSuperassist createSuasSuperassist(String name, String intro, Long datasetId) {
        SuasSuperassist suasSuperassist = new SuasSuperassist();
        suasSuperassist.setSuperassistId(sequenceService.nextVal());
        suasSuperassist.setName(name);
        suasSuperassist.setIntro(intro);
        suasSuperassist.setStatus("00");
        suasSuperassist.setSessionDatasetId(datasetId);
        suasSuperassist.setCreateTime(new Date());
        suasSuperassist.setCreateUser(CurrentUserHolder.getCurrentUserId());
        suasSuperassist.setComAcctId(CurrentUserHolder.getEnterpriseId());
        suasSuperassistMapper.insert(suasSuperassist);
        return suasSuperassist;
    }
}
