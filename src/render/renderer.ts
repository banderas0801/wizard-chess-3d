import * as THREE from 'three';

export interface RendererOptions {
  canvas?: HTMLCanvasElement;
  container: HTMLElement;
}

/**
 * Khởi tạo WebGLRenderer với cấu hình tối ưu bóng PCFSoft và tắt autoUpdate
 */
export function createRenderer(options: RendererOptions): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas: options.canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true
  });

  const width = options.container.clientWidth || window.innerWidth;
  const height = options.container.clientHeight || window.innerHeight;

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

  // Tối ưu hóa bóng đổ PCFSoft
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Bật bóng chỉ khi quân cờ di chuyển thay vì render lại mỗi frame
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  // Tone mapping chuẩn điện ảnh
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  options.container.appendChild(renderer.domElement);
  return renderer;
}
