import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';
import { Spin } from 'antd';
import jsPreviewPdf from '@js-preview/pdf';
import jsPreviewDocx from '@js-preview/docx';
import { init } from 'pptx-preview';
import type jsPreviewExcel from '@js-preview/excel';
import type { JsPdfPreview } from '@js-preview/pdf';
import type { JsDocxPreview } from '@js-preview/docx';
import type { JsExcelPreview } from '@js-preview/excel';
import ss from './Office.module.less';

type PPTXPreviewer = ReturnType<typeof init>;

const clamp = (val: number, min = 0, max = 1) => Math.max(min, Math.min(val, max));

interface OfficeProps {
  data?: string | Blob;
  type?: string;
  loading?: boolean;
  fileName?: string;
}

type DocxProps = Omit<OfficeProps, 'type' | 'fileName'>;

interface Offices {
  (props: OfficeProps): React.ReactNode;
  Pdf(props: DocxProps): React.ReactNode;
  Docx(props: DocxProps): React.ReactNode;
  Pptx(props: DocxProps): React.ReactNode;
  Excel(props: OfficeProps): React.ReactNode;
}

const libs: {
  pdfCss?: boolean;
  jsPreviewPdf?: typeof jsPreviewPdf;
  docxCss?: boolean;
  jsPreviewDocx?: typeof jsPreviewDocx;
  excelCss?: boolean;
  jsPreviewExcel?: typeof jsPreviewExcel;
} = {};

export const Office: Offices = (props) => {
  const { type, data, fileName, ...rest } = props;

  if (type === 'pdf' || fileName?.endsWith('.pdf')) {
    return <Office.Pdf data={data} {...rest} />;
  }
  if (type === 'pptx' || fileName?.endsWith('.pptx')) {
    return <Office.Pptx data={data} {...rest} />;
  }
  if (type === 'docx' || fileName?.endsWith('.docx')) {
    return <Office.Docx data={data} {...rest} />;
  }
  if (type === 'excel' || type === 'xlsx' || fileName?.endsWith('.xlsx')) {
    return <Office.Excel data={data} {...rest} />;
  }
  return null;
};

function OfficeExcel(props: OfficeProps) {
  const { data, loading: spinning } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [inited, setInited] = useState(false);
  const [loading, setLoading] = useState(false);

  useLayoutEffect(() => {
    let viewer: JsExcelPreview | undefined;
    const root = rootRef.current;
    const task1 = new Promise<typeof jsPreviewExcel | undefined>((resolve) => {
      if (libs.jsPreviewExcel) {
        resolve(libs.jsPreviewExcel);
        return;
      }
      import('@js-preview/excel')
        .then((res) => {
          libs.jsPreviewExcel = res.default;
          resolve(libs.jsPreviewExcel);
        })
        .catch(() => resolve(libs.jsPreviewExcel));
    });
    const task2 = new Promise<void>((resolve) => {
      if (libs.pdfCss) {
        resolve();
        return;
      }
      import('@js-preview/excel/lib/index.css')
        .then(() => {
          libs.pdfCss = true;
          resolve();
        })
        .catch(() => resolve());
    });
    if (data) {
      setInited(false);
      // 保证资源都加载完
      const task = Promise.all([task1, task2])
        .then(([lib]) => {
          if (root && lib) {
            root?.firstElementChild?.remove();
            return lib.init(root);
          }
          return null;
        })
        .finally(() => {
          setInited(true);
        });

      // 加载预览
      setLoading(true);
      task
        .then((preview) => {
          if (preview) {
            viewer = preview;
          }
          // 预览
          return data ? viewer?.preview(data) : Promise.resolve();
        })
        .finally(() => setLoading(false));
    }
    return () => {
      viewer?.destroy();
    };
  }, [data]);

  return (
    <section className={ss.office}>
      {(spinning || !inited || loading) && (
        <div className={ss.loading}>
          <Spin spinning />
        </div>
      )}
      <div ref={rootRef} style={{ width: '100%', height: '100%' }} />
    </section>
  );
}

function OfficePdf({ data, loading: spinning }: DocxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const scp = useRef({ count: 0, total: 0 });
  const [size, setSize] = useState<[w: number, h: number]>([0, 0]);
  const [previewer, initPreviewer] = useState<JsPdfPreview>();
  const [loading, setLoading] = useState<boolean>(false);
  const [buffer, setBuffer] = useState<ArrayBuffer>();

  useEffect(() => {
    if (data instanceof Blob) {
      setLoading(true);
      data
        .arrayBuffer()
        .then((buffer) => {
          setBuffer(buffer);
        })
        .finally(() => setLoading(false));
    }
  }, [data]);

  useLayoutEffect(() => {
    const obs = new ResizeObserver(([entry]) => {
      setSize([entry.contentRect.width, entry.contentRect.height]);
    });

    let temp: any;
    if (ref.current?.parentElement) obs.observe(ref.current.parentElement);
    if (ref.current) {
      temp = jsPreviewPdf.init(ref.current, {
        onRendered: () => {
          if (scp.current.total) return;

          scp.current.count = temp.visibleItems;
          scp.current.total = temp.totalItems;
        },
      });
      initPreviewer(temp);
    }

    const scroll = (e: Event) => {
      if (scp.current.count === scp.current.total) return;

      const dom = e.target as HTMLDivElement;
      const max = dom.scrollHeight - 60;
      const per = max / scp.current.total;
      const idx = Math.ceil(dom.scrollTop / per);
      if (scp.current.count - idx < 4) {
        scp.current.count = clamp(scp.current.count + 5, 1, scp.current.total);
        temp.renderList(0, scp.current.count);
      }
    };

    ref.current?.addEventListener('scroll', scroll);
    return () => {
      obs.disconnect();
      temp?.destroy();
      initPreviewer(undefined);
      ref.current?.removeEventListener('scroll', scroll);
    };
  }, [ref]);

  useLayoutEffect(() => {
    if (buffer && previewer) {
      previewer.preview(buffer);
    }
  }, [buffer, previewer]);

  return (
    <section className={ss.office}>
      {(spinning || loading) && (
        <div className={ss.loading}>
          <Spin spinning />
        </div>
      )}
      <div ref={ref} style={{ width: size[0], height: size[1], overflow: 'auto' }} />
    </section>
  );
}

function OfficeDocx({ data, loading: spinning }: DocxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[w: number, h: number]>([0, 0]);
  const [previewer, initPreviewer] = useState<JsDocxPreview>();
  const [loading, setLoading] = useState<boolean>(false);
  const [buffer, setBuffer] = useState<ArrayBuffer>();

  useEffect(() => {
    if (data instanceof Blob) {
      setLoading(true);
      data
        .arrayBuffer()
        .then((buffer) => {
          setBuffer(buffer);
        })
        .finally(() => setLoading(false));
    }
  }, [data]);

  useLayoutEffect(() => {
    const obs = new ResizeObserver(([entry]) => {
      setSize([entry.contentRect.width, entry.contentRect.height]);
    });

    let temp: any;
    if (ref.current?.parentElement) obs.observe(ref.current.parentElement);
    if (ref.current) {
      temp = jsPreviewDocx.init(ref.current, {});
      initPreviewer(temp);
    }
    return () => {
      obs.disconnect();
      temp?.destroy();
      initPreviewer(undefined);
    };
  }, [ref]);

  useLayoutEffect(() => {
    if (buffer && previewer) {
      previewer.preview(buffer);
    }
  }, [buffer, previewer]);

  return (
    <section className={ss.office}>
      {(spinning || loading) && (
        <div className={ss.loading}>
          <Spin spinning />
        </div>
      )}
      <div ref={ref} style={{ width: size[0], height: size[1], overflow: 'auto' }} />
    </section>
  );
}

function OfficePptx({ data, loading: spinning }: DocxProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [previewer, initPreviewer] = useState<PPTXPreviewer>();
  const [loading, setLoading] = useState<boolean>(false);
  const [buffer, setBuffer] = useState<ArrayBuffer>();

  useEffect(() => {
    if (data instanceof Blob) {
      setLoading(true);
      data
        .arrayBuffer()
        .then((buffer) => {
          setBuffer(buffer);
        })
        .finally(() => setLoading(false));
    }
  }, [data]);

  useLayoutEffect(() => {
    let temp: PPTXPreviewer | undefined;
    if (ref.current) {
      temp = init(ref.current, {
        width: ref.current.parentElement?.clientWidth || 310,
        height: ref.current.parentElement?.clientHeight || 310,
      });
      initPreviewer(temp);
    }

    return () => {
      temp?.destroy();
      initPreviewer(undefined);
    };
  }, [ref]);

  useLayoutEffect(() => {
    if (buffer && previewer) {
      previewer.preview(buffer).catch((err) => console.warn(err));
    }
  }, [buffer, previewer]);

  return (
    <section className={ss.office}>
      {(spinning || loading) && (
        <div className={ss.loading}>
          <Spin spinning />
        </div>
      )}
      <div ref={ref} />
    </section>
  );
}

Office.Excel = OfficeExcel;
Office.Pdf = OfficePdf;
Office.Docx = OfficeDocx;
Office.Pptx = OfficePptx;
