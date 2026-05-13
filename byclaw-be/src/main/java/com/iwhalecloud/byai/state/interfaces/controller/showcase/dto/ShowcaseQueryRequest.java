package com.iwhalecloud.byai.state.interfaces.controller.showcase.dto;

import jakarta.validation.constraints.Size;

import com.iwhalecloud.byai.manager.qo.showcase.ShowcaseQueryParam;
import lombok.Getter;
import lombok.Setter;

/**
 * 成果空间查询请求
 *
 * @author system
 * @date 2025-11-10
 */
@Setter
@Getter
public class ShowcaseQueryRequest {

    private Long id;

    /**
     * 会话id
     */
    private Long sessionId;

    /**
     * 类型，ppt,text,chat等前端保存的类型
     */
    private String type;

    /**
     * 特殊数字员工id
     */
    private Long agentId;

    /**
     * 智办任务Id
     */
    private Long taskId;

    /**
     * 关键字，模糊匹配成果空间名称
     */
    @Size(max = 256, message = "查询关键字长度不能超过256字符")
    private String keyword;


    //
    private Boolean queryAll = false;

    /**
     * 会话模式
     */
    @Size(max = 64, message = "会话模式长度不能超过64字符")
    private String sessionMode;

    /**
     * 页码
     */
    private Integer pageNum = 1;

    /**
     * 每页大小
     */
    private Integer pageSize = 20;

    /**
     * 数据状态：1-有效；0-无效
     */
    private Integer status = 1;

    /**
     * 转换为领域查询参数
     *
     * @return ShowcaseQueryParam
     */
    public ShowcaseQueryParam toQueryParam() {
        ShowcaseQueryParam param = new ShowcaseQueryParam();
        param.setSessionId(this.sessionId);
        param.setType(this.type);
        param.setAgentId(this.agentId);
        param.setTaskId(this.taskId);
        param.setKeyword(this.keyword);
        param.setSessionMode(this.sessionMode);
        param.setPageNum(this.pageNum);
        param.setPageSize(this.pageSize);
        param.setStatus(this.status);
        param.setQueryAll(this.queryAll);
        return param;
    }
}


