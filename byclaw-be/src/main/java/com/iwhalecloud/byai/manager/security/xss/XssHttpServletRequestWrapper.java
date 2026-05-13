package com.iwhalecloud.byai.manager.security.xss;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.text.CharacterIterator;
import java.text.StringCharacterIterator;
import java.util.regex.Pattern;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import org.apache.commons.lang3.StringUtils;

public class XssHttpServletRequestWrapper extends HttpServletRequestWrapper {

    private static final Logger logger = LoggerFactory.getLogger(XssHttpServletRequestWrapper.class);


    private static final Pattern scriptPattern = Pattern.compile("<script>(.*?)</script>", Pattern.CASE_INSENSITIVE);

    private static final Pattern srcPattern = Pattern.compile("src[\r\n]*=[\r\n]*\\\'(.*?)\\\'",
        Pattern.CASE_INSENSITIVE | Pattern.MULTILINE | Pattern.DOTALL);

    private static final Pattern srcDoublePattern = Pattern.compile("src[\r\n]*=[\r\n]*\\\"(.*?)\\\"",
        Pattern.CASE_INSENSITIVE | Pattern.MULTILINE | Pattern.DOTALL);

    private static final Pattern closeScriptPattern = Pattern.compile("</script>", Pattern.CASE_INSENSITIVE);

    private static final Pattern scriptExtPattern = Pattern.compile("<script(.*?)>",
        Pattern.CASE_INSENSITIVE | Pattern.MULTILINE | Pattern.DOTALL);

    private static final Pattern evalPattern = Pattern.compile("eval\\((.*?)\\)",
        Pattern.CASE_INSENSITIVE | Pattern.MULTILINE | Pattern.DOTALL);

    private static final Pattern expressionPattern = Pattern.compile("expression\\((.*?)\\)",
        Pattern.CASE_INSENSITIVE | Pattern.MULTILINE | Pattern.DOTALL);

    private static final Pattern javascriptPattern = Pattern.compile("javascript:", Pattern.CASE_INSENSITIVE);

    private static final Pattern vbScriptPattern = Pattern.compile("vbscript:", Pattern.CASE_INSENSITIVE);

    private static final Pattern onLoadPattern = Pattern.compile("onload(.*?)=",
        Pattern.CASE_INSENSITIVE | Pattern.MULTILINE | Pattern.DOTALL);

    private static final Pattern iFramePattern = Pattern.compile("<iframe>(.*?)</iframe>", Pattern.CASE_INSENSITIVE);

    private static final Pattern closeIFramePattern = Pattern.compile("</iframe>", Pattern.CASE_INSENSITIVE);

    private static final Pattern iFrameExtPattern = Pattern.compile("<iframe(.*?)>",
        Pattern.CASE_INSENSITIVE | Pattern.MULTILINE | Pattern.DOTALL);

    private static final Pattern specialCharPattern = Pattern.compile(
        "<[`~!@#$%^&*()+=|{}':;',\\[\\].<>/?~！@#￥%……&*（）——+|{}【】‘；：”“’。，、？]>",
        Pattern.CASE_INSENSITIVE | Pattern.MULTILINE | Pattern.DOTALL);

    private HttpServletRequest request;

    XssHttpServletRequestWrapper(HttpServletRequest request) {
        super(request);
        this.request = request;
    }

    @Override
    public String getParameter(String name) {
        String value = super.getParameter(name);
        if (StringUtils.isEmpty(value)) {
            return value;
        }
        return this.judgeXssString(value);
    }

    @Override
    public String[] getParameterValues(String name) {
        String[] values = super.getParameterValues(name);
        if (values == null) {
            return null;
        }
        for (int i = 0; i < values.length; i++) {
            if (StringUtils.isEmpty(values[i])) {
                values[i] = values[i];
            }
            else {
                values[i] = this.judgeXssString(values[i]);
            }
        }
        return values;
    }

    @Override
    public String getHeader(String name) {
        String header = super.getHeader(name);
        if (StringUtils.isEmpty(header)) {
            return header;
        }
        return this.judgeXssString(header);
    }

    @Override
    public ServletInputStream getInputStream() throws IOException {
        // 请求方法为POST时会触发这个方法
        return getInputStreamWithXSSFilter();
    }

    private ServletInputStream getInputStreamWithXSSFilter() throws IOException {

        // 从inputStream读取字符串
        InputStream in = super.getInputStream();
        StringBuffer body = new StringBuffer();
        InputStreamReader reader = new InputStreamReader(in, Charset.forName("UTF-8"));
        BufferedReader buffer = new BufferedReader(reader);
        String line = buffer.readLine();
        while (line != null) {
            body.append(line);
            line = buffer.readLine();
        }
        buffer.close();
        reader.close();
        in.close();

        // 使用hutool的Html工具类过滤
        String str = judgeXssString(body.toString());
        // 双引号不需要过滤因此替换回原来的符号
        str = str.replace("&quot;", "\"");
        // 因为request里面的inputStream已经读取过,指针指向结尾重新读取会发生异常,
        // 而且过滤后的字符串可能和之前的字符串不同,因此将过滤后的字符串重新转成inputStream返回
        final ByteArrayInputStream bain = new ByteArrayInputStream(str.getBytes());
        return new ServletInputStream() {
            @Override
            public int read() {
                return bain.read();
            }

            @Override
            public boolean isFinished() {
                return false;
            }

            @Override
            public boolean isReady() {
                return false;
            }

            @Override
            public void setReadListener(ReadListener listener) {
            }
        };
    }

    @Override
    public HttpServletRequest getRequest() {
        return request;
    }

    /**
     * 根据系统参数配置，判断是否转换xss
     * 
     * <pre>
     *     系统参数没配置，将xss转换为空字符；否则，直接抛异常
     * </pre>
     * 
     * @param val 页面参数
     * @return String
     */
    private String judgeXssString(String val) {
        if (val == null) {
            return null;
        }

        // 是否包含XSS攻击内容
        if (this.isXssString(val)) {
            logger.error("当前内容包含xss攻击:{}", val);
            val = this.htmlEncode(val);
        }

        // 如果没有检测到XSS，直接返回原值
        return val;
    }

    /**
     * 对一些特殊字符进行转义
     */
    public String htmlEncode(String aText) {
        final StringBuilder result = new StringBuilder();
        final StringCharacterIterator iterator = new StringCharacterIterator(aText);
        char character = iterator.current();
        while (character != CharacterIterator.DONE) {
            if (character == '<') {
                result.append("&lt;");
            }
            else if (character == '>') {
                result.append("&gt;");
            }
            else {
                result.append(character);
            }
            character = iterator.next();
        }
        return result.toString();
    }

    /**
     * 检测字符串是否包含XSS攻击内容
     *
     * @param value 待检测的字符串
     * @return true 如果包含XSS攻击内容，false 如果不包含
     */
    private boolean isXssString(String value) {
        // 检测各种XSS攻击模式
        if (scriptPattern.matcher(value).find()) {
            return true;
        }

        if (srcPattern.matcher(value).find()) {
            return true;
        }

        if (srcDoublePattern.matcher(value).find()) {
            return true;
        }

        if (closeScriptPattern.matcher(value).find()) {
            return true;
        }

        if (scriptExtPattern.matcher(value).find()) {
            return true;
        }

        if (evalPattern.matcher(value).find()) {
            return true;
        }

        if (expressionPattern.matcher(value).find()) {
            return true;
        }

        if (javascriptPattern.matcher(value).find()) {
            return true;
        }

        if (vbScriptPattern.matcher(value).find()) {
            return true;
        }

        if (onLoadPattern.matcher(value).find()) {
            return true;
        }

        if (iFramePattern.matcher(value).find()) {
            return true;
        }

        if (closeIFramePattern.matcher(value).find()) {
            return true;
        }

        if (iFrameExtPattern.matcher(value).find()) {
            return true;
        }

        if (specialCharPattern.matcher(value).find()) {
            return true;
        }

        // 如果没有检测到任何XSS攻击内容，返回false
        return false;
    }
}
