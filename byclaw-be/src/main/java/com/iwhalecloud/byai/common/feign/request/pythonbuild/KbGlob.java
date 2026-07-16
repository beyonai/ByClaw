package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * QA 知识库路径模式匹配请求。
 *
 * @author qin.guoquan
 * @date 2026-07-14 19:38:38
 */
@Getter
@Setter
public class KbGlob {

    private String knCode;

    private String pathRule;
}
