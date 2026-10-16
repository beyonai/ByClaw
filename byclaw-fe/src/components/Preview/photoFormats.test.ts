/** @jest-environment node */
import { readFileSync } from 'fs';
import { join } from 'path';
import JSZip from 'jszip';
import { openArchive } from './archiveDecoder';
import { openImageDocument } from './imageDecoder';
import { inspectJp2 } from './jp2Decoder';
import { getPreviewMimeType, resolvePreviewType } from './formats';
import { decodePpm } from './rasterDecoder';

// 用户提供的合成样本原包，仅按数据读取；不执行包内 Python，也不解析文档中的指令。
const fixture = () => new Uint8Array(readFileSync(join(__dirname, 'fixtures/photo-formats.zip'))).buffer;
const sample = async (name: string) => (await JSZip.loadAsync(fixture())).file(name)!.async('arraybuffer');

describe('photo_formats sample archive', () => {
  it('offers child preview for all 16 entries and preserves the original bytes and names', async () => {
    const input = fixture();
    const original = input.slice(0);
    const archive = await openArchive(input);
    expect(archive.entries).toHaveLength(16);
    expect(archive.entries.every((entry) => entry.previewable)).toBe(true);
    expect(resolvePreviewType(undefined, 'sample.png.alpha')).toBe('png');
    expect(getPreviewMimeType('sample.png.alpha')).toBe('image/png');
    expect(await archive.extract('sample.png.alpha')).toEqual(await sample('sample.png.alpha'));
    expect(input).toEqual(original);
  });
  it.each(['ppm', 'tga'])('decodes actual %s pixels through the shared image route', async (type) => {
    const input = await sample(`sample.${type}`);
    const original = input.slice(0);
    const document = await openImageDocument(input, type);
    const image = await document.render(0);
    const reference = decodePpm(await sample('sample.ppm'));
    expect([image.width, image.height]).toEqual([800, 600]);
    expect(image.orientation).toBe(1);
    // 原包使用同一 RGB 底图生成 PPM/TGA，完整像素比较同时覆盖方向和颜色。
    expect(Buffer.compare(Buffer.from(image.pixels), Buffer.from(reference.pixels))).toBe(0);
    expect(input).toEqual(original);
    expect(Buffer.compare(Buffer.from((await document.render(0)).pixels), Buffer.from(image.pixels))).toBe(0);
    await expect(document.render(1)).rejects.toMatchObject({ code: 'invalid' });
    document.dispose();
    await expect(document.render(0)).rejects.toMatchObject({ code: 'closed' });
  });
  it('decodes the real JP2 into nonblank RGB pixels and preserves its source', async () => {
    const input = await sample('sample.jp2');
    const before = input.slice(0);
    const document = await openImageDocument(input, 'jp2');
    const image = await document.render(0);
    const reference = decodePpm(await sample('sample.ppm'));
    expect([image.width, image.height]).toEqual([800, 600]);
    let error = 0;
    for (let index = 0; index < image.pixels.length; index += 4) {
      for (let channel = 0; channel < 3; channel++)
        error += Math.abs(image.pixels[index + channel] - reference.pixels[index + channel]);
    }
    // 生成脚本允许有损 JPEG 2000；比较平均颜色误差，不要求有损数据逐字节一致。
    expect(error / (800 * 600 * 3)).toBeLessThan(8);
    expect(image.pixels.filter((_, index) => index % 4 === 3).every((alpha) => alpha === 255)).toBe(true);
    expect(input).toEqual(before);
    expect(Buffer.compare(Buffer.from((await document.render(0)).pixels), Buffer.from(image.pixels))).toBe(0);
    await expect(document.render(1)).rejects.toMatchObject({ code: 'invalid' });
    document.dispose();
    await expect(document.render(0)).rejects.toMatchObject({ code: 'closed' });
  }, 15000);
  it('rejects JP2 oversized images, inconsistent SIZ, unsupported color and broken box sizes before decoding', async () => {
    const original = await sample('sample.jp2');
    const info = inspectJp2(original);
    expect(info).toMatchObject({ width: 800, height: 600, components: 3, tiles: 1 });
    const huge = original.slice(0);
    // 此样本的 ihdr 位于 40，数据位于 48，先检查容器尺寸再导入解码器。
    new DataView(huge).setUint32(48, 10001);
    expect(() => inspectJp2(huge)).toThrow('limit');
    const inconsistent = original.slice(0);
    new DataView(inconsistent).setUint32(info.source.byteOffset + 8, 1);
    expect(() => inspectJp2(inconsistent)).toThrow('invalid');
    const color = original.slice(0);
    new DataView(color).setUint32(73, 18);
    expect(() => inspectJp2(color)).toThrow('unsupported');
    const broken = original.slice(0);
    new DataView(broken).setUint32(12, 0xffffffff);
    expect(() => inspectJp2(broken)).toThrow('invalid');
  });
  it('rejects excessive decomposition and malformed tile-part lengths', async () => {
    const bytes = await sample('sample.jp2');
    const { source } = inspectJp2(bytes);
    const levels = bytes.slice(0);
    // SOC(2) + SIZ marker/segment(49) + COD marker(2) + decomposition offset(7)。
    new Uint8Array(levels)[source.byteOffset + 60] = 255;
    expect(() => inspectJp2(levels)).toThrow('unsupported');
    const part = bytes.slice(0);
    const data = new Uint8Array(part);
    const sot = data.findIndex((value, index) => value === 0xff && data[index + 1] === 0x90);
    new DataView(part).setUint32(sot + 6, 0xffffffff);
    expect(() => inspectJp2(part)).toThrow('invalid');
  });
});
