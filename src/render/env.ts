import { PMREMGenerator, type Texture, type WebGLRenderer } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/**
 * Loads an equirectangular .hdr and prefilters it into a PMREM env map exactly once.
 * The generator and the source equirect texture are disposed before returning;
 * the caller owns (and must eventually dispose) the returned texture.
 */
export async function loadEnvironment(r: WebGLRenderer, url: string): Promise<Texture> {
  const source = await new HDRLoader().loadAsync(url);
  const pmrem = new PMREMGenerator(r);
  try {
    return pmrem.fromEquirectangular(source).texture;
  } finally {
    pmrem.dispose();
    source.dispose();
  }
}
