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

    @NotBlank(message = "用户名不能为空")
    @Size(min = 2, max = 20, message = "{user.username.size}")
    @Pattern(regexp = "^[a-zA-Z0-9\\p{IsHan}]+$", message = "{user.username.validate}")
    private String userName;

    @Size(max = 400, message = "头像地址不能超过 400 个字符")
    private String avatar;

    /** 省略则保留原值；提供时必须为非空组织名称。 */
    @Size(max = 100, message = "公司 / 组织名称不能超过 100 个字符")
    @Pattern(regexp = "(?s).*\\S.*", message = "公司 / 组织名称不能为空")
    private String companyName;

    /** 省略则保留原值，空字符串清空自填岗位。 */
    @Size(max = 50, message = "岗位不能超过 50 个字符")
    private String profileRole;

    /** JSON 字符串数组；省略保留原值，[] 清空。 */
    @Size(max = 300, message = "兴趣领域内容过长")
    private String profileInterests;

    private MultipartFile avatarFile;

    public UserProfileUpdateRequest() {
    }

    public UserProfileUpdateRequest(String userName, String avatar) {
        this.userName = userName;
        this.avatar = avatar;
    }
}
