package com.iwhalecloud.byai.state.domain.agent.dto;

import lombok.Getter;
import lombok.Setter;
import java.util.Map;

@Getter
@Setter
public class AgentDto {
    /**
     * 智能体id
     */
    private String id;

    /**
     * 智能体名称
     */
    private String name;

    /**
     * comon:普通智能体，chatbi：问数, writer:慧笔，dighum：数字人(精灵)
     */
    private String agentType;

    /**
     * 智能体描述(会影响python路由规则)
     */
    private String intro;

    /**
     * 智能体头像的url
     */
    private String avatar;

    /**
     * 创建人id
     */
    private String creater;

    /**
     * 创建时间
     */
    private String createTime;

    private String status;

    private String codeType;

    private String prologue;

    private String faq;

    private String relPlugin;

    private String relDataset;

    private String agentSseUrl;

    /**
     * 0：草稿，1发布，2上架，3已下架
     */
    private Integer metaStatus;

    private Map<String, Object> headers;

}