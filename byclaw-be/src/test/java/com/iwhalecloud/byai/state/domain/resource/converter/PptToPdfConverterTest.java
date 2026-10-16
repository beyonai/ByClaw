package com.iwhalecloud.byai.state.domain.resource.converter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.awt.Dimension;
import java.io.ByteArrayOutputStream;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.poi.hslf.usermodel.HSLFSlideShow;
import org.junit.jupiter.api.Test;

class PptToPdfConverterTest {

    private final PptToPdfConverter converter = new PptToPdfConverter();

    @Test
    void convertsRealLegacySlidesToPdfPagesWithoutChangingSourceBytes() throws Exception {
        byte[] source;
        try (HSLFSlideShow presentation = new HSLFSlideShow();
            ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            presentation.setPageSize(new Dimension(640, 360));
            presentation.createSlide().addTitle().setText("First slide");
            presentation.createSlide().addTitle().setText("Second slide");
            presentation.write(output);
            source = output.toByteArray();
        }
        byte[] original = source.clone();
        byte[] result = converter.convertToPdf(source);
        try (PDDocument pdf = Loader.loadPDF(result)) {
            assertThat(pdf.getNumberOfPages()).isEqualTo(2);
            assertThat(pdf.getPage(0).getMediaBox().getWidth()).isEqualTo(640);
            assertThat(pdf.getPage(0).getMediaBox().getHeight()).isEqualTo(360);
            assertThat(pdf.getPage(0).getResources().getXObjectNames()).isNotEmpty();
            assertThat(pdf.getPage(1).getResources().getXObjectNames()).isNotEmpty();
        }
        assertThat(source).containsExactly(original);
        assertThat(converter.supports("PPT")).isTrue();
        assertThat(converter.supports("pptx")).isFalse();
    }

    @Test
    void rejectsEmptyAndExcessivePresentationsInsteadOfReturningPartialPreviews() throws Exception {
        try (HSLFSlideShow presentation = new HSLFSlideShow();
            ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            presentation.write(output);
            assertThatThrownBy(() -> converter.convertToPdf(output.toByteArray()))
                .isInstanceOf(IllegalArgumentException.class);
            for (int index = 0; index <= PptToPdfConverter.MAX_SLIDES; index++) presentation.createSlide();
            output.reset();
            presentation.write(output);
            assertThatThrownBy(() -> converter.convertToPdf(output.toByteArray()))
                .isInstanceOf(IllegalArgumentException.class);
        }
    }
}
