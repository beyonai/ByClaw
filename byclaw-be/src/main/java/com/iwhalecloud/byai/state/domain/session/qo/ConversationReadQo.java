package com.iwhalecloud.byai.state.domain.session.qo;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-04-17 19:38:18
 * @ 会话文件按行读取请求。
 */
@Getter
@Setter
public class ConversationReadQo {

    private String userCode;

    private String sessionId;

    private String objectKey;

    private String filePath;

    /**
     * 开始行，0 表示从第一行开始。
     */
    @JsonProperty("begin_line")
    private Integer beginLine;

    /**
     * 结束行，-1 表示读到结尾；其他值按“上界不包含”处理。
     */
    @JsonProperty("end_line")
    private Integer endLine;
}
