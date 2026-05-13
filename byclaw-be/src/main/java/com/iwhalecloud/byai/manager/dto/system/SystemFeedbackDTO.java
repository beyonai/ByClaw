package com.iwhalecloud.byai.manager.dto.system;

import com.iwhalecloud.byai.manager.entity.system.SystemFeedback;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-08-19 21:02:54
 * @description TODO
 */
@Getter
@Setter
public class SystemFeedbackDTO extends SystemFeedback {

    private List<Long> attachFileIds = new ArrayList<>(10);



}
