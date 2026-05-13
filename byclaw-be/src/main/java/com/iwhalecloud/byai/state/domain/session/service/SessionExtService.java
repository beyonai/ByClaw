package com.iwhalecloud.byai.state.domain.session.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionExtMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-02-14 10:48:27
 * @description TODO
 */
@Service
public class SessionExtService {

    @Autowired
    private ByaiSessionExtMapper byaiSessionExtMapper;

    /**
     * 保存会话成员
     *
     * @param byaiSessionExt 会话信息
     */
    public void save(ByaiSessionExt byaiSessionExt) {
        byaiSessionExtMapper.insert(byaiSessionExt);
    }

    /**
     * 创建会话
     *
     * @param sessionId 会话信息
     */
    public void deleteSessionExtBySessionId(Long sessionId) {
        LambdaQueryWrapper<ByaiSessionExt> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSessionExt::getSessionId, sessionId);
        byaiSessionExtMapper.delete(queryWrapper);
    }

    /**
     * 根据会话查询
     * 
     * @param sessionId 会话标识
     * @return List
     */
    public List<ByaiSessionExt> selectBySessionId(Long sessionId) {
        LambdaQueryWrapper<ByaiSessionExt> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSessionExt::getSessionId, sessionId);
        return byaiSessionExtMapper.selectList(queryWrapper);
    }

    /**
     * 根据参数编码和参数值查询
     * @param paramCode 参数编码
     * @param paramValue 参数值
     * @return ByaiSessionExt
     */
    public ByaiSessionExt selectByParamCodeAndValue(String paramCode, String paramValue) {
        LambdaQueryWrapper<ByaiSessionExt> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSessionExt::getExtParamCode, paramCode);
        queryWrapper.eq(ByaiSessionExt::getExtParamValue, paramValue);
        return byaiSessionExtMapper.selectOne(queryWrapper);
    }

}
