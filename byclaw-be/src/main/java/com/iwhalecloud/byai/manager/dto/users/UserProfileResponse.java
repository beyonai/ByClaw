package com.iwhalecloud.byai.manager.dto.users;

import java.util.List;

/** 已保存的个人资料展示字段；自填岗位与权限岗位分离。 */
public record UserProfileResponse(String userName, String avatar, String companyName,
                                  String profileRole, List<String> profileInterests) {
    public UserProfileResponse(String userName, String avatar) {
        this(userName, avatar, null, null, List.of());
    }
}
