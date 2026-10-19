package com.iwhalecloud.byai.manager.dto.users;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;
import org.springframework.web.multipart.MultipartFile;

/** 当前登录用户可修改的个人资料表单。 */
@Getter
@Setter
public class UserProfileUpdateRequest {

    @NotBlank(message = "{profile.userName.required}")
    @Size(min = 2, max = 20, message = "{user.username.size}")
    @Pattern(regexp = "^[a-zA-Z0-9\\p{IsHan}]+$", message = "{user.username.validate}")
    private String userName;

    @Size(max = 400, message = "{profile.avatar.max}")
    private String avatar;

    /** 省略则保留原值；提供时必须为非空组织名称。 */
    @Size(max = 100, message = "{profile.company.max}")
    @Pattern(regexp = "(?s).*\\S.*", message = "{profile.company.blank}")
    private String companyName;

    /** 省略则保留原值，空字符串清空自填岗位。 */
    @Size(max = 50, message = "{profile.role.max}")
    private String profileRole;

    /** JSON 字符串数组；省略保留原值，[] 清空。 */
    @Size(max = 300, message = "{profile.interests.max}")
    private String profileInterests;

    private MultipartFile avatarFile;

    public UserProfileUpdateRequest() {
    }

    public UserProfileUpdateRequest(String userName, String avatar) {
        this.userName = userName;
        this.avatar = avatar;
    }
}
