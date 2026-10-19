declare module 'utif' {
  interface TiffPage {
    [tag: string]: any;
    data?: Uint8Array;
    width?: number;
    height?: number;
  }
  const UTIF: {
    decode(buffer: ArrayBuffer): TiffPage[];
    decodeImage(buffer: ArrayBuffer, page: TiffPage, pages?: TiffPage[]): void;
    toRGBA8(page: TiffPage): Uint8Array;
    encodeImage(rgba: ArrayBuffer, width: number, height: number): ArrayBuffer;
  };
  export default UTIF;
}

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifPixels {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(target: HeifPixels, callback: (result: HeifPixels | null) => void): void;
    free(): void;
  }
  const initialize: () => Promise<{
    HeifDecoder: new () => { decode(buffer: Uint8Array): HeifImage[] };
  }>;
  export default initialize;
}
