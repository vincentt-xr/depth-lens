interface ImportMetaEnv {
  readonly MODE: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly BASE_URL: string;
  readonly VITE_PREVIEW?: string;
  readonly VITE_INPUT_SOURCE?: string;
  readonly VITE_INPUT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.mp4" {
  const src: string;
  export default src;
}
declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.jpg" {
  const src: string;
  export default src;
}
declare module "*.webp" {
  const src: string;
  export default src;
}
