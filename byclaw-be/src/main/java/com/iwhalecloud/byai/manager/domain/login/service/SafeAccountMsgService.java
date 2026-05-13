package com.iwhalecloud.byai.manager.domain.login.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.mapper.login.SafeAccountMsgMapper;
import com.iwhalecloud.byai.manager.entity.login.SafeAccountMsg;
import com.iwhalecloud.byai.common.util.DateUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.Date;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-09-12 00:01:34
 * @description TODO
 */
@Service
public class SafeAccountMsgService {

    @Autowired
    private SafeAccountMsgMapper safeAccountMsgMapper;

    /***
     * 保存短信信息
     *
     * @param safeAccountMsg 短信信息
     */
    public void save(SafeAccountMsg safeAccountMsg) {
        safeAccountMsgMapper.insert(safeAccountMsg);
    }

    /***
     * 更新短信信息
     * 
     * @param safeAccountMsg 短信信息
     */
    public void update(SafeAccountMsg safeAccountMsg) {
        safeAccountMsgMapper.updateById(safeAccountMsg);
    }

    /**
     * 根据手机号码找出最近所有未过期的验证码
     *
     * @param phone 号码
     * @param msgType 短信类型
     * @return List
     */
    public List<SafeAccountMsg> qryLastByPhone(String phone, String msgType) {
        // 找出过期时间大于当前时间的
        LambdaQueryWrapper<SafeAccountMsg> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SafeAccountMsg::getPhone, phone);
        queryWrapper.eq(SafeAccountMsg::getMsgType, msgType);
        queryWrapper.eq(SafeAccountMsg::getState, SafeAccountMsg.STATE_SEND_SUCCESS);
        queryWrapper.ge(SafeAccountMsg::getExpireDate, new Date());
        queryWrapper.orderByDesc(SafeAccountMsg::getCreateDate);
        return safeAccountMsgMapper.selectList(queryWrapper);
    }

    /**
     * 根据手机号码找出最近所有未过期的验证码
     *
     * @param phone 号码
     * @param msgType 短信类型
     * @param repeatedInterval 重复时间
     * @return List
     */
    public List<SafeAccountMsg> qryInterval(String phone, String msgType, int repeatedInterval) {
        LambdaQueryWrapper<SafeAccountMsg> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SafeAccountMsg::getMsgType, msgType);
        queryWrapper.eq(SafeAccountMsg::getPhone, phone);
        // 如果有在间隔时间内的,时间取负数
        queryWrapper.ge(SafeAccountMsg::getCreateDate, DateUtils.addMinute(new Date(), -repeatedInterval));
        queryWrapper.isNotNull(SafeAccountMsg::getCreateDate);
        return safeAccountMsgMapper.selectList(queryWrapper);
    }

}
