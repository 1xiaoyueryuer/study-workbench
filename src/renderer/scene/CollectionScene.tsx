import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { catalog, type Collectible } from "../../shared/collection";
declare global {
  interface Window {
    collectionMetrics?: {
      frames: number;
      frameHistogram: number[];
      drawCalls: number;
      triangles: number;
    };
  }
}
export function CollectionScene({
  items,
  lowMotion,
}: {
  items: Collectible[];
  lowMotion: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef({ items, lowMotion });
  state.current = { items, lowMotion };
  const [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0),
    [missing, setMissing] = useState(false);
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      setError(true);
      return;
    }
    setError(false);
    setMissing(false);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const metrics = {
      frames: 0,
      frameHistogram: Array.from({ length: 501 }, () => 0),
      drawCalls: 0,
      triangles: 0,
    };
    window.collectionMetrics = metrics;
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 6, 14);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xfffdf5, 0x8daba2, 3));
    const light = new THREE.DirectionalLight(0xfff5df, 4);
    light.position.set(-4, 8, 6);
    scene.add(light);
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xc5e2da,
      transparent: true,
      opacity: 0.12,
      roughness: 0.13,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const white = new THREE.MeshStandardMaterial({
      color: 0xf4f0e6,
      roughness: 0.55,
    });
    const water = new THREE.MeshPhysicalMaterial({
      color: 0xb9d9d1,
      transparent: true,
      opacity: 0.13,
      roughness: 0.15,
      depthWrite: false,
    });
    const groups: THREE.Group[] = [],
      holders: THREE.Group[] = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      groups.push(g);
      scene.add(g);
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 1.9), white);
      base.position.y = -0.92;
      g.add(base);
      const aquarium = new THREE.Mesh(
        new THREE.BoxGeometry(2.25, 1.65, 1.65),
        glass,
      );
      g.add(aquarium);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(aquarium.geometry),
        new THREE.LineBasicMaterial({
          color: 0x9cb8ad,
          transparent: true,
          opacity: 0.55,
        }),
      );
      g.add(edges);
      const waterline = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 1.6),
        water,
      );
      waterline.rotation.x = -Math.PI / 2;
      waterline.position.y = 0.57;
      g.add(waterline);
      const foot = new THREE.Mesh(
        new THREE.BoxGeometry(2.15, 0.07, 1.55),
        white,
      );
      foot.position.y = -1.055;
      g.add(foot);
      const h = new THREE.Group();
      holders.push(h);
      g.add(h);
    }
    let disposed = false,
      raf = 0,
      key = "",
      time = 0,
      last = performance.now();
    const loader = new GLTFLoader(),
      cache = new Map<string, THREE.Group>(),
      pending = new Set<string>();
    const disposeObject = (o: THREE.Object3D) =>
      o.traverse((v) => {
        if (v instanceof THREE.Mesh) {
          v.geometry.dispose();
          for (const m of Array.isArray(v.material) ? v.material : [v.material])
            m.dispose();
        }
      });
    const fallback = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.35, 1),
      new THREE.MeshStandardMaterial({ color: 0xdfd5b5, roughness: 0.3 }),
    );
    const rebuild = () => {
      for (let i = 0; i < 6; i++) {
        holders[i].clear();
        const item = state.current.items.find((v) => v.tank_index === i);
        if (!item) continue;
        const c = catalog.find((v) => v.id === item.catalog_id);
        if (!c) continue;
        const model = cache.get(c.id);
        if (model) {
          const clone = model.clone(true);
          holders[i].add(clone);
        } else {
          holders[i].add(fallback.clone());
          if (!pending.has(c.id)) {
            pending.add(c.id);
            loader.load(
              `./${c.model}`,
              (gltf) => {
                if (disposed) {
                  disposeObject(gltf.scene);
                  return;
                }
                const box = new THREE.Box3().setFromObject(gltf.scene),
                  size = box.getSize(new THREE.Vector3()),
                  center = box.getCenter(new THREE.Vector3());
                gltf.scene.position.sub(center);
                const wrapper = new THREE.Group();
                wrapper.add(gltf.scene);
                wrapper.scale.setScalar(
                  1.05 / Math.max(size.x, size.y, size.z),
                );
                cache.set(c.id, wrapper);
                key = "";
              },
              undefined,
              () => {
                if (!disposed) setMissing(true);
              },
            );
          }
        }
      }
    };
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const narrow = w < 780;
      groups.forEach((g, i) =>
        g.position.set(
          narrow ? ((i % 2) - 0.5) * 3 : ((i % 3) - 1) * 3,
          narrow ? 1.9 - Math.floor(i / 2) * 2 : 1.2 - Math.floor(i / 3) * 2.6,
          0,
        ),
      );
      camera.position.z = narrow ? 18 : 14;
      key = "";
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const loss = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      setError(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", loss);
    const render = () => {
      if (disposed || document.hidden) return;
      raf = requestAnimationFrame(render);
      const now = performance.now();
      if (now - last < 15.5) return;
      const elapsed = now - last;
      const delta = Math.min(elapsed / 1000, 0.1);
      last = now;
      const next = JSON.stringify([
        state.current.lowMotion,
        state.current.items.map((i) => [i.id, i.tank_index]),
      ]);
      const changed = next !== key;
      if (changed) {
        key = next;
        rebuild();
      }
      if (state.current.lowMotion && !changed) return;
      if (!state.current.lowMotion) time += delta;
      holders.forEach((h, i) => {
        h.rotation.y = state.current.lowMotion
          ? 0
          : Math.sin(time * 0.3 + i) * 0.22;
        h.position.y = state.current.lowMotion
          ? 0
          : Math.sin(time * 0.8 + i) * 0.045;
      });
      renderer.render(scene, camera);
      metrics.frames++;
      metrics.frameHistogram[Math.min(500, Math.round(elapsed))]++;
      metrics.drawCalls = renderer.info.render.calls;
      metrics.triangles = renderer.info.render.triangles;
    };
    const visibility = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      if (!document.hidden) render();
    };
    document.addEventListener("visibilitychange", visibility);
    resize();
    render();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", loss);
      scene.traverse((v) => {
        if (v instanceof THREE.Mesh || v instanceof THREE.LineSegments) {
          v.geometry.dispose();
          for (const m of Array.isArray(v.material) ? v.material : [v.material])
            m.dispose();
        }
      });
      cache.forEach(disposeObject);
      disposeObject(fallback);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [attempt]);
  return (
    <>
      <div
        className="collection-scene"
        ref={host}
        aria-label="六个玻璃展示缸"
      />
      {(error || missing) && (
        <div className="scene-error">
          {error
            ? "展示兼容模式，物品仍保留"
            : "部分模型加载失败，已用替代物显示"}
          <button onClick={() => setAttempt((a) => a + 1)}>重试展示</button>
        </div>
      )}
    </>
  );
}
