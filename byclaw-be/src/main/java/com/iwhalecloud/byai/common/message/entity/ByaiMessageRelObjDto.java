package com.iwhalecloud.byai.common.message.entity;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-02-09 13:56:57
 * @description TODO
 */
@Getter
@Setter
public class ByaiMessageRelObjDto {

    private Long relId;

    private Long comAcctId;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date askTime;

    private Long askObjId;

    private String askAccessTerminal;

    private Float taskDueTime;

    private Long askMsgId;

    private String askObjType;

    private String resObjType;

    private Date resTime;

    private String resContent;

    private Long resObjId;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    private Long resMsgId;

    private String resAccessTerminal;

    private Long projectId;

    private Long taskId;

    private Integer requestStatus;

    private String askContent;

    /** token 输入token总数 */
    private Float inputTokenCount;

    /** token 输出token总数 */
    private Float outputTokenCount;

    /** token 每秒输出token数 */
    private Float outputTokenPerSecond;

    private Float firstTextDuration;

    private String feedbackType;

    // @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private String feedbackTime;

    private List<String> feedbackLabel;

    private Float feedbackScore;

    private String feedbackContent;

    private Long sessionId;

    private String askContentTags;

    private String resContentTags;

}
