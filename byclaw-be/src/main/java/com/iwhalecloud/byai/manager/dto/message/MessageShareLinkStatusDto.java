package com.iwhalecloud.byai.manager.dto.message;

import com.iwhalecloud.byai.manager.entity.message.MessageShareLink;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.Builder;
import lombok.experimental.SuperBuilder;

/**
 * 消息分享链接状态 DTO（继承 MessageShareLink，增加是否成功标识）
 */
@Getter
@Setter
@NoArgsConstructor
@SuperBuilder
public class MessageShareLinkStatusDto extends MessageShareLink {

    /**
     * 是否成功
     */
    @Builder.Default
    private Boolean isSuccess = true;

}
