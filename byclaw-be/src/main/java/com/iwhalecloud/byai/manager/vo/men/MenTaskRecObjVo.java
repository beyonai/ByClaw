package com.iwhalecloud.byai.manager.vo.men;

import com.iwhalecloud.byai.manager.entity.men.MenTaskRecObj;
import lombok.Getter;
import lombok.Setter;


/**
 * 待办任务接收对象表
 */
@Getter
@Setter
public class MenTaskRecObjVo extends MenTaskRecObj {

    private String userCode;

    private String userName;
}