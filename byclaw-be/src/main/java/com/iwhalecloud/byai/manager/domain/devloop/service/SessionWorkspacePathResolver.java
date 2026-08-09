package com.iwhalecloud.byai.manager.domain.devloop.service;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;

/**
 * 会话私有工作区的宿主机路径解析。唯一事实源:{nfs根}/{bucket}/by/.sessions/{sessionId}[/{repoName}]。
 * 沙箱内数字员工看到的 /by/.sessions/{sessionId}/ 与这里拼出的宿主机路径是同一份 NFS 数据,
 * 所以读本地 git 变更、集成测试 backend 直跑克隆用例都必须走这里,不能另开 /tmp 之类的临时目录,
 * 否则同一份代码在员工侧与后端侧分叉,产物也不在用户桶里、前端会话空间看不到。
 * bucket 必须按会话创建者的 userCode 解析:桶是按人隔离的,用触发人算会指到别人的桶。
 */
@Service
public class SessionWorkspacePathResolver {

    private static final Logger log = LoggerFactory.getLogger(SessionWorkspacePathResolver.class);

    /** 会话私有工作区目录名,即 {bucket}/by/.sessions 里的 by 段,与前端会话空间口径一致。 */
    public static final String SESSION_WORKSPACE_SEGMENT = "by/.sessions";

    /** 本地文件存储根(NFS 挂载点),与 LocalStorageService 同源配置。 */
    @Value("${file.storage.local.path:${byclaw.sandbox.volume.file-root:/tmp/byclaw-storage}}")
    private String fileStorageRoot;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private UserBucketNamingService userBucketNamingService;

    /**
     * 会话工作区目录的宿主机绝对路径:{nfs根}/{bucket}/by/.sessions/{sessionId}。
     * ownerUserId 传会话创建者;解析不到桶名时返回 null,调用方自行兜底,不要拼出半截路径。
     */
    public String resolveSessionDir(Long ownerUserId, Object sessionKey) {
        String bucket = resolveBucket(ownerUserId);
        if (bucket == null || sessionKey == null) {
            return null;
        }
        return joinPath(fileStorageRoot, bucket, SESSION_WORKSPACE_SEGMENT, String.valueOf(sessionKey));
    }

    /**
     * 用户桶根目录:{nfs根}/{bucket}。执行机跑命令前用它探挂载 —— 桶根不存在说明该机器没挂这份 NFS,
     * 此时任何会话路径都是假的,mkdir -p 只会凭空造一棵与用户桶无关的空目录树(排查时极难看出)。
     */
    public String resolveBucketDir(Long ownerUserId) {
        String bucket = resolveBucket(ownerUserId);
        return bucket == null ? null : joinPath(fileStorageRoot, bucket);
    }

    /** 会话工作区里某个 git 仓库的宿主机绝对路径;repoName 为空时退化为会话目录。 */
    public String resolveRepoDir(Long ownerUserId, Object sessionKey, String repoName) {
        String sessionDir = resolveSessionDir(ownerUserId, sessionKey);
        if (sessionDir == null || StringUtils.isBlank(repoName)) {
            return sessionDir;
        }
        return sessionDir + "/" + repoName;
    }

    private String resolveBucket(Long ownerUserId) {
        if (ownerUserId == null) {
            return null;
        }
        try {
            LoginInfo owner = loginApplicationService.getLoginInfo(ownerUserId);
            if (owner == null || StringUtils.isBlank(owner.getUserCode())) {
                return null;
            }
            return userBucketNamingService.buildUserBucketName(owner.getUserCode());
        }
        catch (Exception e) {
            log.warn("[Devloop] 解析用户桶名失败, userId={}", ownerUserId, e);
            return null;
        }
    }

    /** 统一用 / 拼接:结果同时要喂给远程 shell 命令,不能带平台分隔符。 */
    private static String joinPath(String... segments) {
        StringBuilder sb = new StringBuilder();
        for (String segment : segments) {
            String trimmed = StringUtils.strip(StringUtils.defaultString(segment), "/");
            if (trimmed.isEmpty()) {
                continue;
            }
            sb.append('/').append(trimmed);
        }
        return sb.toString();
    }
}
