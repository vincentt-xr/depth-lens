interface ImportMetaEnv {
  readonly MODE: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly BASE_URL: string;
  readonly VITE_PREVIEW?: string;
  readonly VITE_INPUT_SOURCE?: string;
  readonly VITE_INPUT_URL?: string;
  readonly VITE_FRAMED_SOURCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
