package com.iwhalecloud.byai.state.interfaces.controller.message.dto;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

/**
 * 消息分享链接 返回VO
 */
@Schema(description = "消息分享链接返回VO")
@Getter
@Setter
@NoArgsConstructor
@ToString
public class MessageShareLinkResponse implements Serializable {

    @Serial
    private static final long serialVersionUID = -1L;

    /**
     * 消息列表
     */
    private List<ByaiMessageHotDto> messages = new ArrayList<>();

    /**
     * 分享链接标题
     */
    private String title;

    /**
     * 分享链接生成时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createdTime;

}
