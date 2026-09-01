package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-04-27 18:13:05
 * @description TODO
 */
@Getter
@Setter
public class Data {

    public Data() {
        this.data = new ArrayList<>();
    }

    private List<DirOrFile> data;

    private Integer pageNum = 1;

    private Integer pageSize = 5;

    private Long total = 0L;

}
