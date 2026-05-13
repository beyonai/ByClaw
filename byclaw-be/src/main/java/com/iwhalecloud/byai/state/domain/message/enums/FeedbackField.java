package com.iwhalecloud.byai.state.domain.message.enums;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 反馈字段枚举
 */
public enum FeedbackField {

    TYPE("feedback_type"),
    CONTENT("feedback_content"),
    SCORE("feedback_score"),
    CON_MARK("feedback_con_mark"),
    LABEL("feedback_label");

    private final String fieldName;

    FeedbackField(String fieldName) {
        this.fieldName = fieldName;
    }

    public String getFieldName() {
        return fieldName;
    }
    
    /**
     * 获取所有字段名称
     */
    public static List<String> getAllFieldNames() {
        return Arrays.stream(values())
                .map(FeedbackField::getFieldName)
                .collect(Collectors.toList());
    }
    
    /**
     * 获取点踩相关的所有字段名称
     */
    public static List<String> getTreadFieldNames() {
        return Arrays.asList(
                TYPE.fieldName,
                CONTENT.fieldName,
                SCORE.fieldName,
                CON_MARK.fieldName,
                LABEL.fieldName
        );
    }
}