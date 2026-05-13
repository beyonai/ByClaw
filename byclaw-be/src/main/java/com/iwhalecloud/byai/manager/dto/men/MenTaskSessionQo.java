package com.iwhalecloud.byai.manager.dto.men;

import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.io.Serializable;

/**
 * 待办任务创建类，继承Session
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class MenTaskSessionQo extends ByaiSession implements Serializable {

    /** 主键标识 */
    private Long taskId;
}