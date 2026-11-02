package com.iwhalecloud.byai.state.domain.resource.converter;

import java.awt.Color;
import java.awt.Dimension;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import javax.imageio.ImageIO;

import org.apache.poi.hslf.usermodel.HSLFSlide;
import org.apache.poi.hslf.usermodel.HSLFSlideShow;
import org.springframework.stereotype.Component;

import com.lowagie.text.Document;
import com.lowagie.text.Image;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.PdfWriter;

/** 旧版 PPT 按幻灯片生成静态 PDF 副本，避免影响现有 PPTX 浏览器渲染。 */
@Component
public class PptToPdfConverter implements FileConverterStrategy {

    static final int MAX_SLIDES = 100;

    private static final int MAX_IMAGE_EDGE = 1600;

    @Override
    public boolean supports(String fileType) {
        return "ppt".equalsIgnoreCase(fileType);
    }

    @Override
    public byte[] convertToPdf(byte[] bytes) throws Exception {
        try (HSLFSlideShow presentation = new HSLFSlideShow(new ByteArrayInputStream(bytes));
            ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Dimension pageSize = presentation.getPageSize();
            int count = presentation.getSlides().size();
            if (count == 0 || count > MAX_SLIDES || pageSize.width <= 0 || pageSize.height <= 0) {
                // 由应用层统一翻译转换失败信息；不返回截断后却看似完整的文档。
                throw new IllegalArgumentException("Invalid slide count or page size");
            }
            double scale = Math.min(2d, (double) MAX_IMAGE_EDGE / Math.max(pageSize.width, pageSize.height));
            int width = Math.max(1, (int) Math.ceil(pageSize.width * scale));
            int height = Math.max(1, (int) Math.ceil(pageSize.height * scale));
            Document document = new Document(new Rectangle(pageSize.width, pageSize.height), 0, 0, 0, 0);
            PdfWriter writer = PdfWriter.getInstance(document, output);
            document.open();
            try {
                for (HSLFSlide slide : presentation.getSlides()) {
                    BufferedImage rendered = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
                    try {
                        Graphics2D graphics = rendered.createGraphics();
                        try {
                            graphics.setColor(Color.WHITE);
                            graphics.fillRect(0, 0, width, height);
                            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                            graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING,
                                RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
                            graphics.scale(scale, scale);
                            slide.draw(graphics);
                        }
                        finally {
                            graphics.dispose();
                        }
                        // 逐页释放位图；图片写入 PDF，不执行宏、动画或嵌入对象。
                        ByteArrayOutputStream imageBytes = new ByteArrayOutputStream();
                        ImageIO.write(rendered, "png", imageBytes);
                        Image image = Image.getInstance(imageBytes.toByteArray());
                        document.newPage();
                        image.scaleAbsolute(pageSize.width, pageSize.height);
                        image.setAbsolutePosition(0, 0);
                        writer.getDirectContent().addImage(image);
                    }
                    finally {
                        rendered.flush();
                    }
                }
            }
            finally {
                document.close();
            }
            return output.toByteArray();
        }
    }
}
