package com.iwhalecloud.byai.manager.domain.login.model;

import lombok.Getter;
import lombok.Setter;

import java.awt.Graphics2D;
import java.awt.Color;
import java.awt.Font;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.OutputStream;
import java.security.SecureRandom;

import javax.imageio.ImageIO;

@Getter
@Setter
public class ValidateCode {
    // 图片的宽度。
    private int width = 160;

    // 图片的高度。
    private int height = 40;

    // 验证码字符个数
    private int codeCount = 5;

    // 验证码干扰线数
    private int lineCount = 150;

    // 验证码
    private String code = null;

    // 验证码图片Buffer
    private BufferedImage buffImg = null;

    private char[] codeSequence = {
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
    };

    public ValidateCode() {
        this.createCode();
    }

    /**
     * @param width 图片宽
     * @param height 图片高
     * @param codeCount 字符个数
     * @param lineCount 干扰线条数
     */
    public ValidateCode(int width, int height, int codeCount, int lineCount) {
        this.width = width;
        this.height = height;
        this.codeCount = codeCount;
        this.lineCount = lineCount;
        this.createCode();
    }

    public void createCode() {
        int x = 0;
        int codeY = 0;
        x = width / codeCount; // 每个字符的宽度
        codeY = height - 1;

        // 图像buffer
        buffImg = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = buffImg.createGraphics();
        // 生成随机数
        SecureRandom random = new SecureRandom();
        // 将图像填充为白色
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, width, height);

        for (int i = 0; i < lineCount; i++) {
            int xs = random.nextInt(width);
            int ys = random.nextInt(height);
            int xe = xs + random.nextInt(width / 8);
            int ye = ys + random.nextInt(height / 8);
            g.setColor(Color.BLACK);
            g.drawLine(xs, ys, xe, ye);
        }

        // randomCode记录随机产生的验证码
        StringBuffer randomCode = new StringBuffer();
        // 使用 JDK 自带的逻辑字体名 SANS_SERIF（跨平台兼容，不依赖系统字体）
        Font font = new Font(Font.SANS_SERIF, Font.BOLD, 18);
        // 随机产生codeCount个字符的验证码。
        for (int i = 0; i < codeCount; i++) {
            String strRand = String.valueOf(codeSequence[random.nextInt(codeSequence.length)]);
            g.setColor(Color.BLACK);
            g.setFont(font);
            g.drawString(strRand, i * x, codeY);
            // 将产生的四个随机数组合在一起。
            randomCode.append(strRand);
        }
        // 将四位数字的验证码保存到Session中。
        code = randomCode.toString();
    }

    public void write(OutputStream sos) throws IOException {
        ImageIO.write(buffImg, "png", sos);
    }

}