package com.iwhalecloud.byai.manager.qo.conversation;

import java.io.Serializable;
import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Setter
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class SearchQo implements Serializable {

    // 回复对象类型 (HUMAN, AGENT)
    private List<String> resObjType;

    // 回复对象标识
    private List<Long> resObjId;

    // 提问对象标识
    private List<Long> askObjId;

    // 提问对象类型 (HUMAN, AGENT)
    private List<String> askObjType;

    // 提问来源终端 (Web, APP)
    private List<String> askAccessTerminal;

    // 回复来源终端 (Web, APP)
    private List<String> resAccessTerminal;

    // 反馈类型 (praise, tread)
    private String feedbackType;

    // 反馈标签
    private List<String> feedbackLabel;

    // 反馈评分
    private List<Double> feedbackScore;

    // 来源渠道
    private List<Long> projectId;

    // 提问消息内容
    private String askContent;

    // 回复消息内容
    private String resContent;

    // 提问消息向量
    private List<Double> askContentVector;

    // 回复消息向量
    private List<Double> resContentVector;

    /**
     * 页码
     */
    private Integer pageNum;

    /**
     * 页面大小
     */
    private Integer pageSize;

}