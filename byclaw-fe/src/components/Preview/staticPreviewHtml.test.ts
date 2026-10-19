import { staticPreviewHtml } from './staticPreviewHtml';

it('keeps static text/tables and valid bitmap data while blocking active and remote content', () => {
  const html = staticPreviewHtml(
    '<h1 onclick="run()">标题</h1><table><tr><td>cell</td></tr></table><script>run()</script><iframe src="https://example.com"></iframe><a href="javascript:run()">link</a><img src="https://example.com/a.png"><img src="data:image/svg+xml;base64,AAAA"><img src="data:image/png;base64,iVBORw0KGgo=">'
  );
  expect(html).toContain('<h1>标题</h1>');
  expect(html).toContain('<td>cell</td>');
  expect(html).toContain('data:image/png;base64,iVBORw0KGgo=');
  expect(html).toContain("default-src 'none'");
  expect(html).not.toMatch(/onclick|<script|<iframe|href=|https:|image\/svg/);
});
