package com.iwhalecloud.byai.common.feign.request.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-03-10 14:39:16
 * @description TODO
 */
@Getter
@Setter
public class KeywordsFilter {

    private List<String> keywordsAnd;

    private List<String> keywordsOr;
}
