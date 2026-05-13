package com.iwhalecloud.byai.manager.dto.openapi;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

/**
 * 用户组织信息DTO
 * 
 * @author system
 * @date 2025-09-02
 */
@Setter
@Getter
@Schema(description = "用户组织信息")
public class UserOrganizationDTO implements Serializable {

    // Getters and Setters
    @Schema(description = "用户ID", example = "1001")
    private Long userId;

    @Schema(description = "组织路径代码，多个组织用空格分隔", example = "-1.1 -1.2")
    private String pathCode;

    @Schema(description = "组织路径名称，多个组织用空格分隔", example = "百应客户 技术部")
    private String pathName;

    public UserOrganizationDTO() {
    }

    public UserOrganizationDTO(Long userId, String pathCode, String pathName) {
        this.userId = userId;
        this.pathCode = pathCode;
        this.pathName = pathName;
    }

}
