package com.iwhalecloud.byai.state.domain.resource.converter;

public interface FileConverterStrategy {
    boolean supports(String fileType);
    byte[] convertToPdf(byte[] fileStream) throws Exception;

}
