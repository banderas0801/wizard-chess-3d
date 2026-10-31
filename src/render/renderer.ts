import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';

export interface RendererHandle {
  readonly renderer: WebGLRenderer;
  /**
   * The ONLY way shadow maps get re-rendered. shadowMap.autoUpdate is false, so call this
   * once at init and whenever a piece moves; nothing else may set shadowMap.needsUpdate.
   */
  markShadowsDirty(reason: 'init' | 'piece-move'): void;
  readonly shadowUpdates: { readonly init: number; readonly 'piece-move': number };
}

export function createRenderer(canvasParent: HTMLElement): RendererHandle {
  const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  canvasParent.appendChild(renderer.domElement);

  const shadowUpdates = { init: 0, 'piece-move': 0 };
  return {
    renderer,
    shadowUpdates,
    markShadowsDirty(reason) {
      shadowUpdates[reason] += 1;
      renderer.shadowMap.needsUpdate = true;
    },
  };
}
