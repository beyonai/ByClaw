package com.iwhalecloud.byai.manager.domain.superassist.domain;

import lombok.Data;

/**
 * @author he.duming
 * @date 2025-05-06 22:12:29
 * @description TODO
 */
@Data
public class AssistPrologue {


    /**
     * 助理 logo，默认值为 'default'
     */
    private String extAvatar = "default";

    /**
     * 助理名称
     */
    private String extName;


    /**
     * 助理简介
     */
    private String extIntro = "数字分身";


    /**
     * 你希望助理叫你什么名字？
     */
    private String nickName;

    /**
     * 希望助手记住什么？
     */
    private String memoryMessage;


}
