package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class AgtAgent {
    private List<Object> agtSampleList;
    /**
     * 资源类型 1是智能体
     */
    private Integer appType;

    private List<Object> appVarList;
    private String avatar;
    /**
     * 3是简易编排
     */
    private Integer codeType;
    /**
     * 智能体创建时间戳
     */
    private Long createTime;
    /**
     * 创建用户
     */
    private Long createUser;

    /**
     * 知识库列表
     */
    private List<Object> datasetList;

    /**
     *
     */
    private List<Object> datasourceBaseList;

    private Long dirId;

    private String feedbackTips;

    /**
     * 智能体ID
     */
    private Long id;

    private List<Object> intelligentList;
    /**
     * 智能体描述
     */
    private String intro;
    private Object isAssociated;
    private List<Object> modules;
    /**
     * 智能体名称
     */
    private String name;
    private Long objId;
    private List<Object> openingIntroList;
    private Object permission;
    private List<Object> pluginList;
    private Long projectId;
    private String prologue;
    private Object recommendPrompt;
    private Long relModelId;
    private List<Object> relSubAppList;
    private Long resourceId;
    private Long resourceStatus;
    private Long resourceType;
    private Object sampleInfo;
    private List<Object> sampleQuestionList;
    private Long scriptId;
    private Long simpleTemplateId;
    private Object source;
    private Long status;
    private Long teamId;
    private Long tmbId;
    private String type;
    private Long updateTime;
    private Long updateUser;
    private Object v;
    private Long versionId;

    private Long appId;

}
