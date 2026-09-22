package com.iwhalecloud.byai.manager.application.service.user;

import java.io.IOException;
import java.util.Date;
import java.util.Map;
import java.util.UUID;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 复用数字员工图标存储，将上传结果保存为当前用户的头像。
 */
@Service
public class UserAvatarApplicationService {

    private static final long MAX_AVATAR_SIZE = 5 * 1024 * 1024;

    private static final Map<String, String> IMAGE_EXTENSIONS = Map.of(
        "image/png", ".png", "image/jpeg", ".jpg", "image/gif", ".gif", "image/webp", ".webp");

    private final FilesApplicationService filesApplicationService;

    private final UsersMapper usersMapper;

    public UserAvatarApplicationService(FilesApplicationService filesApplicationService, UsersMapper usersMapper) {
        this.filesApplicationService = filesApplicationService;
        this.usersMapper = usersMapper;
    }

    /**
     * 只允许更新登录态所属用户；数据库写入失败时回滚文件元数据和用户更新。
     */
    @Transactional(rollbackFor = Exception.class)
    public String uploadAvatar(MultipartFile file) throws IOException {
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        if (loginInfo == null || loginInfo.getUserId() == null || loginInfo.getUserId() <= 0
            || StringUtils.isBlank(loginInfo.getUserCode())) {
            throw new BaseException("login.user.not.logged.in");
        }
        if (file == null || file.isEmpty()) {
            throw new BaseException("头像文件不能为空");
        }
        if (file.getSize() > MAX_AVATAR_SIZE) {
            throw new BaseException("头像文件不能超过 5 MB");
        }
        String contentType = file.getContentType();
        String extension = contentType == null ? null : IMAGE_EXTENSIONS.get(contentType);
        if (extension == null) {
            throw new BaseException("仅支持 PNG、JPEG、GIF 或 WebP 图片");
        }
        Users user = usersMapper.selectById(loginInfo.getUserId());
        if (user == null || !UserState.ACTIVE.equals(user.getState())) {
            throw new BaseException("用户不存在或已禁用");
        }

        // 独立对象名避免同秒上传覆盖，也允许客户端使用中文或带特殊字符的文件名。
        MultipartFile avatar = new MultipartFileUtil("file", UUID.randomUUID() + extension, contentType,
            file.getBytes());
        String url = filesApplicationService.uploadIcon(avatar).getFileUrl();
        if (StringUtils.isBlank(url) || url.length() > 400) {
            throw new BaseException("头像存储未返回有效地址");
        }

        // 精确更新头像，避免同时编辑用户资料时覆盖其他字段。
        int updated = usersMapper.update(null, new LambdaUpdateWrapper<Users>()
            .eq(Users::getUserId, loginInfo.getUserId())
            .eq(Users::getState, UserState.ACTIVE)
            .set(Users::getAvatar, url)
            .set(Users::getUpdateDate, new Date()));
        if (updated != 1) {
            throw new BaseException("用户头像保存失败");
        }
        return url;
    }
}
