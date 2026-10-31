import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

export type QualityTier = 'off' | 'low' | 'high';

export interface PostProcessingPipeline {
  setTier: (tier: QualityTier) => void;
  getTier: () => QualityTier;
  render: (delta: number) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

/**
 * Đọc tham số tier từ URL query string: ?tier=off|low|high
 */
export function getTierFromUrl(): QualityTier | null {
  if (typeof window === 'undefined' || !window.location) return null;
  const params = new URLSearchParams(window.location.search);
  const tierParam = params.get('tier')?.toLowerCase();
  if (tierParam === 'off' || tierParam === 'low' || tierParam === 'high') {
    return tierParam as QualityTier;
  }
  return null;
}

/**
 * Khởi tạo hệ thống hậu kỳ phân tầng QualityTier:
 * - 'off': Render trực tiếp qua renderer.render (tiết kiệm GPU tối đa)
 * - 'low': RenderPass + UnrealBloomPass (Ánh sáng đuốc và rune ma thuật)
 * - 'high': RenderPass + Bloom + GTAOPass + SMAAPass (Đầy đủ chi tiết bóng góc khuất & khử răng cưa)
 */
export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): PostProcessingPipeline {
  let width = window.innerWidth;
  let height = window.innerHeight;

  const urlTier = getTierFromUrl();
  let currentTier: QualityTier = urlTier || 'high';

  // 1. Base EffectComposer
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 2. GTAO Pass (Bóng góc khuất giáo đường)
  const gtaoPass = new GTAOPass(scene, camera, width, height);
  gtaoPass.output = GTAOPass.OUTPUT.Default;
  gtaoPass.blendIntensity = 0.8;
  gtaoPass.enabled = currentTier === 'high';
  composer.addPass(gtaoPass);

  // 3. UnrealBloomPass (Phát quang ngọn lửa & bệ ma thuật)
  const bloomResolution = new THREE.Vector2(width, height);
  const bloomPass = new UnrealBloomPass(bloomResolution, 0.45, 0.4, 0.85);
  bloomPass.enabled = currentTier === 'low' || currentTier === 'high';
  composer.addPass(bloomPass);

  // 4. SMAAPass (Khử răng cưa chất lượng cao)
  const smaaPass = new SMAAPass(width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
  smaaPass.enabled = currentTier === 'high';
  composer.addPass(smaaPass);

  function applyTier(tier: QualityTier) {
    currentTier = tier;
    switch (tier) {
      case 'off':
        gtaoPass.enabled = false;
        bloomPass.enabled = false;
        smaaPass.enabled = false;
        break;
      case 'low':
        gtaoPass.enabled = false;
        bloomPass.enabled = true;
        smaaPass.enabled = false;
        break;
      case 'high':
        gtaoPass.enabled = true;
        bloomPass.enabled = true;
        smaaPass.enabled = true;
        break;
    }
  }

  // Khởi tạo ban đầu
  applyTier(currentTier);

  return {
    setTier: (tier: QualityTier) => {
      // Nếu có URL param cố định thì ưu tiên giữ theo URL param
      if (urlTier && tier !== urlTier) return;
      applyTier(tier);
    },
    getTier: () => currentTier,
    render: (delta: number) => {
      if (currentTier === 'off') {
        renderer.render(scene, camera);
      } else {
        composer.render(delta);
      }
    },
    resize: (newW: number, newH: number) => {
      width = newW;
      height = newH;
      composer.setSize(width, height);
      gtaoPass.setSize(width, height);
      smaaPass.setSize(width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
    },
    dispose: () => {
      composer.dispose();
      gtaoPass.dispose();
      bloomPass.dispose();
      smaaPass.dispose();
    }
  };
}
