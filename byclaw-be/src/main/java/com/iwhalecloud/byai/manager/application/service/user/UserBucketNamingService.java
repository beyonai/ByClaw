package com.iwhalecloud.byai.manager.application.service.user;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;

/**
 * 用户默认桶命名服务。
 * 统一管理 byclaw-{userCode} 的命名规则，避免“后台创建用户初始化桶”
 * 和“开放接口会话文件读写”各自维护一套桶名算法。
 * @author qin.guoquan
 * @date 2026-04-17 19:38:18
 */
@Service
public class UserBucketNamingService {

    public String buildUserBucketName(String userCode) {
        return UserBucketNameResolver.buildUserBucketName(userCode);
    }
}
