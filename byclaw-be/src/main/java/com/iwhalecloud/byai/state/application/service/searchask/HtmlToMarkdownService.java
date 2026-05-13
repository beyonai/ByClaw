package com.iwhalecloud.byai.state.application.service.searchask;

import com.vladsch.flexmark.html.HtmlRenderer;
import com.vladsch.flexmark.html2md.converter.FlexmarkHtmlConverter;
import com.vladsch.flexmark.util.data.MutableDataSet;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.safety.Cleaner;
import org.jsoup.safety.Safelist;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;

import java.util.regex.Matcher;
import java.util.regex.Pattern;


/**
 * html to md 工具转换器
 */
@Component
public class HtmlToMarkdownService {

    /** Markdown 图片语法：![alt](url) 或 ![](url)，用于过滤无用图片 */
    private static final Pattern MARKDOWN_IMAGE_PATTERN = Pattern.compile("!\\[[^\\]]*\\]\\(([^)]+)\\)");

    /**
     * 无用图片路径关键词：匹配任意一个即视为装饰性/静态资源图片，从结果中移除。
     * 包含：静态资源目录、菜单/联系/关闭/引导等 UI 图标、小 logo、备案等。
     */
    private static final String[] USELESS_IMAGE_PATH_KEYWORDS = {
        "/static/images/",
        "/static/image/",
        "icon_",
        "icon.",
        "menu_message", "menu_yingxiao", "menu_sms", "menu_shop", "menu_api",
        "contact_tel", "contact_online", "contact_weixin",
        "icon_close", "icon_qiyeweixin", "icon_logo",
        "close.png", "close.svg",
        "guide_", "beian", "zhizhao",
        "Partners/logo_",
        "banner_sms", "logo_small", "logo_single"
    };

    /**
     * 将直接传入的HTML字符串转换为Markdown
     * 
     * @param htmlContent HTML字符串
     * @return 格式化后的Markdown字符串
     */
    public String convertHtmlToMarkdown(String htmlContent) {
        // 1. 解析HTML
        Document htmlDoc = Jsoup.parse(htmlContent);
        htmlDoc.outputSettings().prettyPrint(false); // 关闭自动格式化，避免额外换行

        // 2. 清理HTML，只保留核心内容标签
        Document cleanedDoc = cleanIrrelevantHtml(htmlDoc);

        // 3. 提取主要内容（针对搜狐页面优化）
        String coreHtml = extractCoreContent(cleanedDoc);

        // 4. 将清理后的HTML转换为Markdown
        return convertCleanHtmlToMarkdown(coreHtml);
    }

    /**
     * 清理无关的HTML标签和内容（针对搜狐页面优化）
     */
    private Document cleanIrrelevantHtml(Document doc) {
        // 自定义安全标签列表，只保留核心内容标签
        Safelist safelist = Safelist.basic()
            .addTags("h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span", "ul", "ol", "li", "table", "tr", "td",
                "th", "thead", "tbody", "a", "img", "blockquote", "pre", "code", "br")
            .addAttributes("a", "href", "title").addAttributes("img", "src", "alt", "title")
            // 移除所有无关标签
            .removeTags("script", "style", "noscript", "iframe", "header", "footer", "nav", "svg", "canvas", "video",
                "audio", "form");

        Cleaner cleaner = new Cleaner(safelist);
        Document cleanedDoc = cleaner.clean(doc);

        // 额外清理搜狐特有的无关元素
        cleanedDoc.select("header, .sidebar, .nav-list, .share-interaction, .statement, "
            + ".bottom-relate-wrap, #float-btn, .left-bottom-float, "
            + "#articleTransfer, #bannedNotice, #sohu-play-content, "
            + "#articleAllsee, #god_bottom_banner, #meComment, #commentList, "
            + "#discuss, #groomRead, #right-side-bar").remove();

        return cleanedDoc;
    }

    /**
     * 提取HTML中的核心内容（针对搜狐页面优化）
     */
    private static String extractCoreContent(Document doc) {
        // 优先提取搜狐文章的核心编辑区域（#mp-editor）
        Element coreElement = doc.selectFirst("#mp-editor");

        // 备用方案：取文章标题+正文
        if (coreElement == null) {
            coreElement = doc.selectFirst(".text");
        }

        // 最后备选：取body
        if (coreElement == null) {
            coreElement = doc.body();
        }

        // 移除搜狐特有的无关元素和广告链接
        coreElement.select(".backsohucom, .article-tag, .article-info, .user-info, "
            + ".ad, .advertisement, .nav, .footer, .header, .sidebar").remove();

        // 移除空的p标签和多余的换行
        coreElement.select("p:empty").remove();

        return coreElement.html();
    }

    /**
     * 将清理后的HTML转换为Markdown（适配现有FlexmarkHtmlConverter版本）
     */
    private static String convertCleanHtmlToMarkdown(String html) {
        // 初始化配置集，只使用你依赖中存在的配置项
        MutableDataSet options = new MutableDataSet()
                // 列表内容缩进
                .set(FlexmarkHtmlConverter.LIST_CONTENT_INDENT, true)
                // 支持Setext样式标题（下划线式）
                .set(FlexmarkHtmlConverter.SETEXT_HEADINGS, true)
                // 输出未知标签（避免丢失内容）
                .set(FlexmarkHtmlConverter.OUTPUT_UNKNOWN_TAGS, true)
                // 排版式引号（中文引号等）
                .set(FlexmarkHtmlConverter.TYPOGRAPHIC_QUOTES, true)
                // 智能排版（省略号、破折号等）
                .set(FlexmarkHtmlConverter.TYPOGRAPHIC_SMARTS, true)
                // 提取自动链接
                .set(FlexmarkHtmlConverter.EXTRACT_AUTO_LINKS, true)
                // 自动链接换行
                .set(FlexmarkHtmlConverter.WRAP_AUTO_LINKS, true)
                // 渲染注释
                .set(FlexmarkHtmlConverter.RENDER_COMMENTS, false)
                // 列表项缩进
                .set(FlexmarkHtmlConverter.LIST_ITEM_INDENT, 2)
                // 代码缩进
                .set(FlexmarkHtmlConverter.CODE_INDENT, "    ")
                // 添加末尾换行符
                .set(FlexmarkHtmlConverter.ADD_TRAILING_EOL, true)
                // 跳过空属性
                .set(FlexmarkHtmlConverter.SKIP_ATTRIBUTES, true)
                // HTML渲染器配置：软换行用\n
                .set(HtmlRenderer.SOFT_BREAK, "\n");

        // 创建转换器并转换
        FlexmarkHtmlConverter converter = FlexmarkHtmlConverter.builder(options).build();
        String markdown = converter.convert(html);

        // 移除无用的装饰性图片（如 /static/images/contact_tel.png、菜单图标等）
        markdown = removeUselessImages(markdown);

        // 最后清理：移除多余的空行和首尾空格
        markdown = Pattern.compile("\\n{3,}").matcher(markdown).replaceAll("\n\n").trim();

        return markdown;
    }

    /**
     * 从 Markdown 中移除「无用图片」的 ![alt](url)。
     * 当 url 包含静态资源、菜单/联系/关闭等图标路径时整段删除，避免正文出现无意义的图片路径。
     */
    private static String removeUselessImages(String markdown) {
        if (StringUtils.isBlank(markdown)) {
            return markdown;
        }
        Matcher matcher = MARKDOWN_IMAGE_PATTERN.matcher(markdown);
        StringBuffer sb = new StringBuffer();
        while (matcher.find()) {
            String url = matcher.group(1);
            if (isUselessImageUrl(url)) {
                matcher.appendReplacement(sb, "");
            }
        }
        matcher.appendTail(sb);
        String result = sb.toString();
        result = result.replaceAll("\\n{3,}", "\n\n").replaceAll("(?m)^[ \\t]+\\n", "\n").trim();
        return result;
    }

    private static boolean isUselessImageUrl(String url) {
        if (StringUtils.isBlank(url)) {
            return true;
        }
        String lower = url.toLowerCase();
        for (String keyword : USELESS_IMAGE_PATH_KEYWORDS) {
            if (lower.contains(keyword.toLowerCase())) {
                return true;
            }
        }
        return false;
    }

}
