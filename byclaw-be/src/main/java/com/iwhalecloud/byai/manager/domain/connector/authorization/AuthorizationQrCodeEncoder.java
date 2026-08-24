package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.EnumMap;
import java.util.Map;

import javax.imageio.ImageIO;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

/**
 * 将授权地址编码为 PNG data URI，供前端直接渲染二维码。
 *
 * <p>授权地址含一次性 user_code，因此本类不把地址写入日志。
 */
@Component
public class AuthorizationQrCodeEncoder {

    private static final Logger log = LoggerFactory.getLogger(AuthorizationQrCodeEncoder.class);

    private static final String DATA_URI_PREFIX = "data:image/png;base64,";
    private static final int IMAGE_SIZE = 240;
    private static final int QUIET_ZONE_MODULES = 1;
    private static final int MAX_URL_LENGTH = 2048;
    private static final int BLACK = 0x000000;
    private static final int WHITE = 0xFFFFFF;

    /**
     * 编码授权地址。
     *
     * @param authorizationUrl 授权地址，允许为空
     * @return PNG data URI；地址为空、超长或编码失败时返回 {@code null}
     */
    public String encode(String authorizationUrl) {
        if (authorizationUrl == null || authorizationUrl.isBlank()
                || authorizationUrl.length() > MAX_URL_LENGTH) {
            return null;
        }
        try {
            BitMatrix matrix = new QRCodeWriter().encode(
                authorizationUrl, BarcodeFormat.QR_CODE, IMAGE_SIZE, IMAGE_SIZE, hints());
            return DATA_URI_PREFIX + Base64.getEncoder().encodeToString(toPng(matrix));
        } catch (WriterException | IOException | RuntimeException e) {
            // 二维码只是辅助入口，前端会回退到授权链接，因此失败不中断授权流程。
            log.warn("Unable to encode connector authorization QR code: reason={}", e.getMessage());
            return null;
        }
    }

    private Map<EncodeHintType, Object> hints() {
        Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.CHARACTER_SET, StandardCharsets.UTF_8.name());
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
        hints.put(EncodeHintType.MARGIN, QUIET_ZONE_MODULES);
        return hints;
    }

    private byte[] toPng(BitMatrix matrix) throws IOException {
        int width = matrix.getWidth();
        int height = matrix.getHeight();
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < width; x++) {
            for (int y = 0; y < height; y++) {
                image.setRGB(x, y, matrix.get(x, y) ? BLACK : WHITE);
            }
        }
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        if (!ImageIO.write(image, "png", png)) {
            throw new IOException("No PNG writer available");
        }
        return png.toByteArray();
    }
}
