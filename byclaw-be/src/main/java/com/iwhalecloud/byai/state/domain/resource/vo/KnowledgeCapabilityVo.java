package com.iwhalecloud.byai.state.domain.resource.vo;

import lombok.Getter;
import lombok.Setter;

/**
 * 知识库前端页面能力开关视图对象。
 * 用于把当前系统所处的知识库模式和前端可执行的知识库能力统一返回给页面，
 * 避免前端直接感知 dataset.system 等后端配置细节。
 * 当前主要用于控制知识库列表页和详情页中“库级操作”的展示与禁用，
 * 例如知识库的新建、编辑、删除，以及知识库导入入口是否开放。
 *
 * @author qin.guoquan
 * @date 2026-04-22 15:10:00
 */
@Getter
@Setter
public class KnowledgeCapabilityVo {

    private String knowledgeMode;

    private Boolean allowKnowledgeBaseCreate;

    private Boolean allowKnowledgeBaseEdit;

    private Boolean allowKnowledgeBaseDelete;

    private Boolean allowKnowledgeImport;
}
