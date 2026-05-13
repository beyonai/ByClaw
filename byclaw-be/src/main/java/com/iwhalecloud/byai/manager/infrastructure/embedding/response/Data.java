package com.iwhalecloud.byai.manager.infrastructure.embedding.response;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-08-02 00:01:54
 * @description TODO
 */
@Getter
@Setter
public class Data {

    private String object;

    private List<Float> embedding;

    private int index;

}
