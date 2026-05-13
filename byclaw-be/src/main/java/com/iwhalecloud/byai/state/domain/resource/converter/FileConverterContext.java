package com.iwhalecloud.byai.state.domain.resource.converter;


import java.util.List;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class FileConverterContext {

    private final List<FileConverterStrategy> strategies;

    @Autowired
    public FileConverterContext(List<FileConverterStrategy> strategies) {
        this.strategies = strategies;
    }

    public byte[] convertFileToPdf(byte[] fileContent, String fileName) throws Exception {
        String fileType = "";
        int lastIndex = fileName.lastIndexOf('.');
        if (lastIndex == -1 || lastIndex == fileName.length() - 1) {
            fileType = ""; // 如果没有后缀或文件名以点结尾，则返回空字符串
        }
        else {
            fileType = fileName.substring(lastIndex + 1);
        }
        for (FileConverterStrategy strategy : strategies) {
            if (strategy.supports(fileType)) {
                return strategy.convertToPdf(fileContent);
            }
        }
        throw new IllegalArgumentException(I18nUtil.get("file.converter.context.no.converter.found", fileType));
    }
}