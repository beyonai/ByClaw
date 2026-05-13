package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * 对象压缩包导入结果。
 */
@Getter
@Setter
public class ObjectZipImportResult {

    private int total;

    private int success;

    private int failed;

    private int createdCount;

    private int updatedCount;

    private String zipFileName;

    private List<ObjectZipImportItem> createdItems = new ArrayList<>();

    private List<ObjectZipImportItem> updatedItems = new ArrayList<>();

    private List<ObjectZipImportItem> items = new ArrayList<>();
}
