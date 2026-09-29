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

    private MultipartFile avatarFile;

    public UserProfileUpdateRequest() {
    }

    public UserProfileUpdateRequest(String userName, String avatar) {
        this.userName = userName;
        this.avatar = avatar;
    }
}
