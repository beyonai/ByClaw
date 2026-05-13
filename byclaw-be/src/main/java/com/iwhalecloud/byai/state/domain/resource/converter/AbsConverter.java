package com.iwhalecloud.byai.state.domain.resource.converter;

import org.springframework.stereotype.Component;

@Component
public class AbsConverter implements FileConverterStrategy {
    @Override
    public boolean supports(String fileType) {
        return "pdf".equalsIgnoreCase(fileType);
    }

    @Override
    public byte[] convertToPdf(byte[] fileStream) throws Exception {
        return fileStream;
    }
}
