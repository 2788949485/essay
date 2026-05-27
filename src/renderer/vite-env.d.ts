/// <reference types="vite/client" />

import type { SuijiApi } from "../main/preload";

declare global {
  interface Window {
    suiji: SuijiApi;
  }
}
