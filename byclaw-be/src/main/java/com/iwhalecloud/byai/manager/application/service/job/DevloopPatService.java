package com.iwhalecloud.byai.manager.application.service.job;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * GitHub PAT 读取服务
 * 从用户私有参数表中解密获取 GitHub Personal Access Token
 */
@Slf4j
@Service
public class DevloopPatService {

    private static final String PARAM_KEY_GITHUB_PAT = "GH_TOKEN";

    @Autowired
    private UserPrivateParamMapper userPrivateParamMapper;

    /** 根据用户ID查询并解密GitHub PAT，未配置或解密失败返回null */
    public String getGitHubPat(String createBy) {
        Long userId;
        try {
            userId = Long.parseLong(createBy);
        } catch (NumberFormatException e) {
            log.warn("Invalid createBy for PAT lookup: {}", createBy);
            return null;
        }
        LambdaQueryWrapper<UserPrivateParam> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(UserPrivateParam::getUserId, userId)
               .eq(UserPrivateParam::getParamKey, PARAM_KEY_GITHUB_PAT)
               .eq(UserPrivateParam::getDeleteFlag, "0");
        UserPrivateParam param = userPrivateParamMapper.selectOne(wrapper);
        if (param == null || param.getParamValueCipher() == null) {
            return null;
        }
        try {
            return Sm4Util.decrypt(param.getParamValueCipher());
        } catch (Exception e) {
            log.error("Failed to decrypt GitHub PAT for user: {}", createBy, e);
            return null;
        }
    }
}
