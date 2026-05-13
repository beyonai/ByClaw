package com.iwhalecloud.byai.common.feign.request.python;

import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-12-22 14:23:07
 * @description TODO
 */
@Getter
@Setter
public class DigEmployeeGenerate extends DigEmployeeExtCore {

    private String agentName;

    private String agentDescription;

    private String commonQuestions;

    private String ability;

    private String constraints;

    private String faqs;

    private String roleAttributes;

    private String processingFlow;

    private String personalityDimensions;

    private String wordPreferences;

    private String sentenceAndTone;

    private List<CoreCompetency> coreCompetencies;

    /**
     * 语言,默认中文
     */
    private String language = "zh-CN";

}
