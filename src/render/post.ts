import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { QualityTier } from './quality';

export interface Post {
  setTier(t: QualityTier): void;
  readonly tier: QualityTier;
  render(dt: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

// Threshold is in linear HDR (pre tone-mapping) units: only speculars and hot highlights bloom.
const BLOOM = { strength: 0.55, radius: 0.45, threshold: 4 } as const;

/**
 * Tiers: off = plain renderer.render (no composer at all);
 *        low = Render -> Bloom -> Output;
 *        high = Render -> GTAO -> Bloom -> Output -> SMAA.
 * setTier rebuilds the composer/passes on the SAME renderer; it never creates a renderer.
 */
export function createPost(r: WebGLRenderer, scene: Scene, cam: Camera, initial: QualityTier = 'high'): Post {
  const size = r.getSize(new Vector2());
  let width = size.x;
  let height = size.y;
  let tier: QualityTier = initial;
  let composer: EffectComposer | null = null;

  const teardown = (): void => {
    if (!composer) return;
    for (const pass of composer.passes) pass.dispose();
    composer.dispose();
    composer = null;
  };

  const build = (): void => {
    teardown();
    if (tier === 'off') return;
    const c = new EffectComposer(r);
    c.setPixelRatio(r.getPixelRatio());
    c.setSize(width, height);
    c.addPass(new RenderPass(scene, cam));
    if (tier === 'high') {
      const gtao = new GTAOPass(scene, cam, width, height);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.8;
      c.addPass(gtao);
    }
    c.addPass(new UnrealBloomPass(new Vector2(width, height), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
    c.addPass(new OutputPass());
    if (tier === 'high') c.addPass(new SMAAPass());
    composer = c;
  };

  build();

  return {
    get tier() {
      return tier;
    },
    setTier(t) {
      if (t === tier) return;
      tier = t;
      build();
    },
    render(dt) {
      if (composer) composer.render(dt);
      else r.render(scene, cam);
    },
    resize(w, h) {
      width = w;
      height = h;
      composer?.setPixelRatio(r.getPixelRatio());
      composer?.setSize(w, h);
    },
    dispose: teardown,
  };
}
