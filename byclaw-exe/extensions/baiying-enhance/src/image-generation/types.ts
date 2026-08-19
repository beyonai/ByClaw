export type ImageModelSource = "employee" | "global-default";

export type ResolvedImageModel = {
  modelId: string;
  modelCode: string;
  providerName: string;
  modelProtocol: string;
  endpoint: string;
  apiToken: string;
  source: ImageModelSource;
  timeout: number;
};

export type ImageModelErrorCode =
  | "IMAGE_MODEL_NOT_CONFIGURED"
  | "IMAGE_MODEL_UNAVAILABLE";

export class ImageModelResolutionError extends Error {
  readonly code: ImageModelErrorCode;

  constructor(code: ImageModelErrorCode, message: string) {
    super(message);
    this.name = "ImageModelResolutionError";
    this.code = code;
  }
}
