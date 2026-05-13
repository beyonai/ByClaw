package com.iwhalecloud.byai.common.feign.request.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-12-15 17:52:40
 * @description TODO
 */
@Getter
@Setter
public class ContractName {

    private List<String> contractNameAnd = new ArrayList<>();

    private List<String> contractNameOr = new ArrayList<>();

    private List<String> contractNameExclude = new ArrayList<>();
}
