package com.iwhalecloud.byai.manager.dto.conversation;


import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;


@Getter
@Setter
public class FeedbackDto {

    /**
     * 反馈类型
     */
    private String feedbackType;

    /**
     * 反馈内容
     */
    private String feedbackContent;

    /**
     * 反馈分数
     */
    private String feedbackScore;

    /**
     * 反馈问答内容标注
     */
    private List<Map<String, Object>> feedbackConMark;

    /**
     * 反馈标签
     */
    private String feedbackLabel;

    public FeedbackDto(String feedbackType, String feedbackScore, String feedbackContent, String feedbackLabel, List<Map<String, Object>> feedbackConMark) {
        this.feedbackType = feedbackType;
        this.feedbackScore = feedbackScore;
        this.feedbackContent = feedbackContent;
        this.feedbackLabel = feedbackLabel;
        this.feedbackConMark = feedbackConMark;
    }

    public FeedbackDto() {
    }
}
