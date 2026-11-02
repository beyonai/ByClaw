package com.iwhalecloud.byai.state.domain.resource.converter;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Objects;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hwpf.usermodel.Table;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.Test;

class WordToPdfConverterTest {

    private final WordToPdfConverter converter = new WordToPdfConverter();

    @Test
    void convertsRealWord97DocumentToReadablePdfWithoutChangingSource() throws Exception {
        byte[] source = loadDoc();
        byte[] original = source.clone();
        String text = extractText(converter.convertToPdf(source));
        assertThat(text).contains("This is a simple file created with Word 97-SR2.");
        assertThat(source).containsExactly(original);
    }

    @Test
    void preservesLegacyTableCellsAndFollowingBodyText() throws Exception {
        try (HWPFDocument document = new HWPFDocument(new ByteArrayInputStream(loadDoc()));
            ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Table table = document.getRange().insertTableBefore((short) 2, 1);
            table.getRow(0).getCell(0).getParagraph(0).insertBefore("Left cell");
            table.getRow(0).getCell(1).getParagraph(0).insertBefore("Right cell");
            document.write(output);
            String text = extractText(converter.convertToPdf(output.toByteArray()));
            assertThat(text).contains("Left cell", "Right cell", "This is a simple file");
            assertThat(text.indexOf("Left cell")).isLessThan(text.indexOf("This is a simple file"));
        }
    }

    @Test
    void retainsTheExistingDocxConverterForItsOtherCallers() throws Exception {
        try (XWPFDocument document = new XWPFDocument(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            document.createParagraph().createRun().setText("Existing DOCX path");
            document.write(output);
            assertThat(extractText(converter.convertToPdf(output.toByteArray()))).contains("Existing DOCX path");
        }
    }

    private byte[] loadDoc() throws Exception {
        try (InputStream input = Objects.requireNonNull(getClass().getResourceAsStream("/file-preview/simple.doc"))) {
            return input.readAllBytes();
        }
    }

    private String extractText(byte[] bytes) throws Exception {
        try (PDDocument document = Loader.loadPDF(bytes)) {
            assertThat(document.getNumberOfPages()).isGreaterThan(0);
            return new PDFTextStripper().getText(document);
        }
    }
}
