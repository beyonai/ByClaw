package com.iwhalecloud.byai.state.domain.assitsant.service;

import java.util.List;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.mapper.superassist.SuasSuperassistMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class SuperassistService {

    @Autowired
    private SuasSuperassistMapper suasSuperassistMapper;

    /**
     * 获取助理信息
     */
    public SuasSuperassist getAssistant(Long assistantId) {
        return suasSuperassistMapper.selectById(assistantId);
    }

    /**
     * 查找超级助手
     * 
     * @param userId 用户标识
     * @return SuasSuperassist
     */
    public SuasSuperassist findByCreateUser(Long userId) {

        LambdaQueryWrapper<SuasSuperassist> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SuasSuperassist::getSuperassistId, userId);
        List<SuasSuperassist> suasSuperassists = suasSuperassistMapper.selectList(queryWrapper);

        return !suasSuperassists.isEmpty() ? suasSuperassists.get(0) : null;
    }
}
