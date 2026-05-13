package com.iwhalecloud.byai.state.interfaces.controller.message.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import java.io.Serial;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/**
 * 消息分享链接创建请求 DTO
 *
 * @author system
 * @date 2026-01-29
 */
@Schema(description = "消息分享链接创建请求")
@Getter
@Setter
@ToString
@NoArgsConstructor
@AllArgsConstructor
public class MessageShareLinkCreateRequest implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 消息ID列表（必填，一个分享链接可包含多条消息）
     * 显式初始化为空集合，消除构造/反序列化阶段的null风险
     */
    @NotEmpty(message = "{message.share.link.create.request.messageids.notempty}")
    @Schema(description = "消息ID列表", example = "[123456, 789012]", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<Long> messageIds = new ArrayList<>();

    /**
     * 分享链接标题
     */
    @NotEmpty(message = "{message.share.link.create.request.title.notempty}")
    @Size(max = 200, message = "{message.share.link.create.request.title.maxlength}")
    @Schema(description = "分享链接标题", example = "Welcome to the Conversation Server!")
    private String title;

    /**
     * 有效期天数（可选，为空表示永久有效）
     */
    @Schema(description = "有效期天数，为空表示永久有效", example = "7")
    private Integer expireDays;

    /**
     * 最大访问次数（可选，为空表示无限制）
     */
    @Schema(description = "最大访问次数，为空表示无限制", example = "100")
    private Long maxAccessCount;

    /**
     * 访问权限类型：PUBLIC（公开）或 AUTHENTICATED（需登录），默认 AUTHENTICATED
     */
    @Schema(description = "访问权限类型：PUBLIC（公开）或 AUTHENTICATED（需登录）",
            example = "AUTHENTICATED",
            allowableValues = {"PUBLIC", "AUTHENTICATED"})
    private String accessPermission = "AUTHENTICATED"; // 显式初始化默认值，消除null风险
}
