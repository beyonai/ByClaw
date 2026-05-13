package com.iwhalecloud.byai.manager.dto.men;

import lombok.Getter;
import lombok.Setter;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * @author he.duming
 * @date 2025-09-16 11:27:38
 * @description 通知详情DTO
 */
@Getter
@Setter
public class NoticeDetail {

    /**
     * 通知标题
     */
    @NotBlank(message = "{noticedetail.title.notblank}")
    @Size(max = 200, message = "{noticedetail.title.maxsize}")
    private String title;

    /**
     * 通知内容
     */
    @NotBlank(message = "{noticedetail.content.notblank}")
    @Size(max = 2000, message = "{noticedetail.content.maxsize}")
    private String content;

    /**
     * 优先级:1-低 2-中 3-高 4-紧急
     */
    @NotNull(message = "{noticedetail.priority.notnull}")
    @Min(value = 1, message = "{noticedetail.priority.min}")
    @Max(value = 4, message = "{noticedetail.priority.max}")
    private Short priority;

    /**
     * 发送者id(创建人)
     */
    private Long senderId;

    /**
     * 发送者用户代码
     */
    private String sendUserCode;

    /**
     * 接收者id(修改人)
     */
    private Long targetId;

    /**
     * 接收者用户代码
     */
    private String targetUserCode;

}
