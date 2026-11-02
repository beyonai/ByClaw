import { prepareEmlHtml } from './emlHtml';
import type { EmlAttachment } from './emlTypes';

const attachment: EmlAttachment = {
  id: 0,
  name: 'pic.png',
  mime: 'image/png',
  contentId: '<photo>',
  buffer: new Uint8Array([137, 80, 78, 71]).buffer,
};
it('renders only current-email CID bitmaps and strips active content, links and remote resources', () => {
  const html = prepareEmlHtml(
    '<p onclick="run()">Hello</p><script>run()</script><form action="https://example.com"><input></form><iframe src="https://example.com"></iframe><img src="cid:photo"><img src="https://example.com/tracker"><img src="data:image/svg+xml;base64,AAAA"><a href="https://example.com">link</a><style>body{background:url(https://example.com)}</style>',
    [attachment]
  );
  expect(html).toContain('<p>Hello</p>');
  expect(html).toContain('src="data:image/png;base64,iVBORw=="');
  expect(html).toContain("default-src 'none'");
  expect(html).not.toMatch(/onclick|<script|<form|<input|<iframe|href=|https:|image\/svg/);
});

it('does not resolve duplicate IDs, SVG attachments or oversized inline images', () => {
  const duplicates = prepareEmlHtml('<img src="cid:photo">', [attachment, { ...attachment, id: 1 }]);
  expect(duplicates).not.toContain('src="data:');
  const svg = prepareEmlHtml('<img src="cid:photo">', [{ ...attachment, mime: 'image/svg+xml' }]);
  expect(svg).not.toContain('src="data:');
  const large = prepareEmlHtml('<img src="cid:photo">', [
    { ...attachment, buffer: new ArrayBuffer(2 * 1024 * 1024 + 1) },
  ]);
  expect(large).not.toContain('src="data:');
});
