package com.iwhalecloud.byai.manager.dto.ontology;

import lombok.Data;

/**
 * 绑定本体时选中的一个「叶子」节点（该分支上没有更深的选中子节点）。
 * level 决定虚拟资源与 relOntology 的组成：
 * BASE / SCENE / VIEW / OBJECT_IN_SCENE / OBJECT_IN_VIEW。
 *
 * @author qin.guoquan
 * @date 2026-07-04 14:38:38
 */
@Data
public class OntologyBindNode {

    /** BASE / SCENE / VIEW / OBJECT_IN_SCENE / OBJECT_IN_VIEW */
    private String level;

    private String sceneId;
    private String sceneName;
    private String sceneDesc;

    private String viewCode;
    private String viewName;
    private String viewDesc;

    private String objectCode;
    private String objectName;
    private String objectDesc;
}
