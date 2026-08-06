import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';
import { Alert, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import type jsPreviewExcel from '@js-preview/excel';
import type { JsPdfPreview } from '@js-preview/pdf';
import type { JsDocxPreview } from '@js-preview/docx';
import type { JsExcelPreview } from '@js-preview/excel';
import ss from './Office.module.less';

type PdfInit = (el: HTMLElement, opts?: any) => JsPdfPreview;
type DocxInit = (el: HTMLElement, opts?: any) => JsDocxPreview;
type PptxInit = (el: HTMLElement, opts?: any) => any;
type PptxPreviewer = {
  preview: (data: ArrayBuffer) => Promise<unknown>;
  destroy: () => void;
};
type ExcelPreviewer = JsExcelPreview & {
  renderExcel?: (data: ArrayBuffer) => Promise<any>;
};

const clamp = (val: number, min = 0, max = 1) => Math.max(min, Math.min(val, max));

interface OfficeProps {
  data?: string | Blob | ArrayBuffer;
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
  jsPreviewPdf?: PdfInit;
  docxCss?: boolean;
  jsPreviewDocx?: DocxInit;
  pptxInit?: PptxInit;
  excelCss?: boolean;
  jsPreviewExcel?: typeof jsPreviewExcel;
} = {};

const blobToArrayBuffer = (blob: Blob) => {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read blob as ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
};

export const Office: Offices = (props: any) => {
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
  const [previewData, setPreviewData] = useState<string | ArrayBuffer>();

  useEffect(() => {
    let disposed = false;

    if (data instanceof Blob) {
      setLoading(true);
      blobToArrayBuffer(data)
        .then((buffer) => {
          if (!disposed) {
            setPreviewData(buffer);
          }
        })
        .finally(() => {
          if (!disposed) {
            setLoading(false);
          }
        });
    } else {
      setPreviewData(data);
    }

    return () => {
      disposed = true;
    };
  }, [data]);

  useLayoutEffect(() => {
    let viewer: ExcelPreviewer | undefined;
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
    if (previewData) {
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
          if (previewData instanceof ArrayBuffer && typeof viewer?.renderExcel === 'function') {
            return viewer.renderExcel(previewData);
          }
          return viewer?.preview(previewData) || Promise.resolve();
        })
        .finally(() => setLoading(false));
    }
    return () => {
      viewer?.destroy();
    };
  }, [previewData]);

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

    let loadLib = Promise.resolve(libs.jsPreviewPdf!);
    if (!libs.jsPreviewPdf) {
      loadLib = import('@js-preview/pdf').then((mod) => {
        libs.jsPreviewPdf = mod.default.init;
        return libs.jsPreviewPdf!;
      });
    }

    loadLib.then((pdfInit) => {
      if (ref.current) {
        temp = pdfInit(ref.current, {
          onRendered: () => {
            if (scp.current.total) return;
            scp.current.count = temp.visibleItems;
            scp.current.total = temp.totalItems;
          },
        });
        initPreviewer(temp);
      }
    });

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

    let loadLib = Promise.resolve(libs.jsPreviewDocx!);
    if (!libs.jsPreviewDocx) {
      loadLib = import('@js-preview/docx').then((mod) => {
        libs.jsPreviewDocx = mod.default.init;
        return libs.jsPreviewDocx!;
      });
    }

    loadLib.then((docxInit) => {
      if (ref.current) {
        temp = docxInit(ref.current, {});
        initPreviewer(temp);
      }
    });

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
  const intl = useIntl();
  const [loading, setLoading] = useState<boolean>(false);
  const [buffer, setBuffer] = useState<ArrayBuffer>();
  const [size, setSize] = useState<[width: number, height: number]>([0, 0]);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    let disposed = false;

    setBuffer(undefined);
    setPreviewFailed(false);
    if (data instanceof Blob) {
      setLoading(true);
      data
        .arrayBuffer()
        .then((buffer) => {
          if (!disposed) {
            setBuffer(buffer);
          }
        })
        .catch(() => {
          if (!disposed) {
            setPreviewFailed(true);
          }
        })
        .finally(() => {
          if (!disposed) {
            setLoading(false);
          }
        });
    } else if (data instanceof ArrayBuffer) {
      setBuffer(data);
    }

    return () => {
      disposed = true;
    };
  }, [data]);

  useLayoutEffect(() => {
    const root = ref.current;
    const container = root?.parentElement;
    if (!container) return;

    const updateSize = (width: number, height: number) => {
      const nextWidth = Math.floor(width);
      const nextHeight = Math.floor(height);
      if (nextWidth <= 0 || nextHeight <= 0) return;
      setSize((current) => (current[0] === nextWidth && current[1] === nextHeight ? current : [nextWidth, nextHeight]));
    };

    const observer = new ResizeObserver(([entry]) => {
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);
    updateSize(container.clientWidth, container.clientHeight);

    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !buffer || size[0] <= 0 || size[1] <= 0) return;

    let disposed = false;
    let previewer: PptxPreviewer | undefined;

    let loadLib = Promise.resolve(libs.pptxInit!);
    if (!libs.pptxInit) {
      loadLib = import('pptx-preview').then((mod) => {
        libs.pptxInit = mod.init;
        return libs.pptxInit!;
      });
    }

    setLoading(true);
    setPreviewFailed(false);
    root.replaceChildren();
    loadLib
      .then((pptxInit) => {
        if (disposed) return undefined;
        previewer = pptxInit(root, {
          width: size[0],
          height: size[1],
        });
        return previewer.preview(buffer);
      })
      .catch((error) => {
        if (!disposed) {
          console.warn('PPTX preview failed', error);
          setPreviewFailed(true);
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
      previewer?.destroy();
      root.replaceChildren();
    };
  }, [buffer, size]);

  return (
    <section className={ss.office}>
      {(spinning || loading) && (
        <div className={ss.loading}>
          <Spin spinning />
        </div>
      )}
      {previewFailed && (
        <div className={ss.error}>
          <Alert type="error" showIcon message={intl.formatMessage({ id: 'fileBrowser.preview.failed' })} />
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
