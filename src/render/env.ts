import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export interface EnvironmentResult {
  envMap: THREE.Texture;
  dispose: () => void;
}

/**
 * Nạp HDRI 1k (Poly Haven CC0) bằng RGBELoader và tạo PMREM đúng 1 lần rồi giải phóng generator
 */
export async function loadEnvironment(
  renderer: THREE.WebGLRenderer,
  url: string
): Promise<EnvironmentResult> {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  const loader = new RGBELoader();

  try {
    const hdrTexture = await loader.loadAsync(url);
    const envMap = pmremGenerator.fromEquirectangular(hdrTexture).texture;

    // Giải phóng bộ nhớ đệm thô ngay lập tức sau khi nướng PMREM
    hdrTexture.dispose();
    pmremGenerator.dispose();

    return {
      envMap,
      dispose: () => {
        envMap.dispose();
      }
    };
  } catch (err) {
    pmremGenerator.dispose();
    console.warn(`[Env] Không thể tải HDRI từ "${url}", fallback môi trường phòng giả lập.`, err);

    // Fallback: Tạo PMREM từ một scene giả lập tối thiểu nếu chưa có file .hdr
    const fallbackScene = new THREE.Scene();
    fallbackScene.background = new THREE.Color(0x181e2b);

    const lightBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    const lightBoxMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
    const lightBox = new THREE.Mesh(lightBoxGeo, lightBoxMat);
    lightBox.position.set(0, 10, 5);
    lightBox.scale.set(12, 2, 2);
    fallbackScene.add(lightBox);

    const fallbackGenerator = new THREE.PMREMGenerator(renderer);
    const fallbackEnv = fallbackGenerator.fromScene(fallbackScene, 0.04).texture;
    fallbackGenerator.dispose();
    lightBoxGeo.dispose();
    lightBoxMat.dispose();

    return {
      envMap: fallbackEnv,
      dispose: () => {
        fallbackEnv.dispose();
      }
    };
  }
}
