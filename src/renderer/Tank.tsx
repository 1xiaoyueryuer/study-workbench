import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Appearance, Snapshot } from "../shared/contracts";

type Metrics = {
  frames: number;
  frameHistogram: number[];
  dropEvents: number;
  rainCount: number;
  drawCalls: number;
  triangles: number;
  frameMs: number[];
  progress: number;
  textureReady: boolean;
  visualTime: number;
};
declare global {
  interface Window {
    tankMetrics?: Metrics;
  }
}

const vertexShader = `varying vec2 uvScreen;
void main(){uvScreen=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const fragmentShader = `
precision highp float;
varying vec2 uvScreen;
uniform vec2 resolution;
uniform float clockTime, fillLevel, rainEnabled, textureReady;
uniform vec3 waterTint;
uniform sampler2D waterPhoto, normalMap, heightMap;
uniform vec4 drops[24];
float gaussian(float x,float width){return exp(-x*x/(width*width));}
float waterline(float x){
  return fillLevel*resolution.y + sin(x*.006+clockTime*.48)*2.2
       + sin(x*.014-clockTime*.32)*1.1;
}
void main(){
  vec2 p=uvScreen*resolution;
  float line=waterline(p.x);
  float depth=line-p.y;
  float wet=smoothstep(-1.5,2.5,depth);
  vec2 q=p/resolution.y;
  vec2 n=(texture2D(normalMap,q*.64+vec2(clockTime*.004,clockTime*.002)).rg-.5)*12.;
  n+=(texture2D(normalMap,q.yx*.89+vec2(-clockTime*.002,clockTime*.003)).rg-.5)*7.;
  n=clamp(n,vec2(-.7),vec2(.7));
  float ripple=0.;
  float rain=0.;
  float rainShine=0.;
  for(int i=0;i<24;i++){
    float age=clockTime-drops[i].z;
    float flight=drops[i].w;
    float x=drops[i].x*resolution.x;
    float impact=waterline(x)-drops[i].y;
    if(age>=0. && age<flight && rainEnabled>.5){
      float t=age/flight;
      float y=mix(resolution.y+22.,impact,t*t*.55+t*.45);
      vec2 d=p-vec2(x,y);
      float tail=gaussian(d.x, 1.2)*gaussian(d.y-4.,10.);
      float bead=gaussian(d.x,2.5)*gaussian(d.y,4.);
      rain+=tail*.6+bead*.65;
      rainShine+=gaussian(d.x+.6,.45)*gaussian(d.y,2.);
    }
    float a=age-flight;
    if(a>0. && a<4.6){
      vec2 d=(p-vec2(x,impact))/vec2(1.,.28);
      float r=length(d);
      float radius=7.+a*42.;
      float envelope=exp(-a*.7)*smoothstep(0.,.2,a);
      float ring=gaussian(r-radius,2.2)-gaussian(r-radius-3.,3.4)*.65;
      ring+=gaussian(r-radius*.70,1.6)*.42-gaussian(r-radius*.70-2.5,2.4)*.28;
      ripple+=ring*envelope;
      n+=normalize(d+vec2(.001))*ring*.018;
    }
  }
  vec3 paper=vec3(.982,.980,.957);
  paper+=vec3(.004,.009,.012)*sin(uvScreen.x*3.+uvScreen.y*2.);
  // The photograph is sampled as softly lit optical detail, never as a dark backdrop.
  vec2 photoUv=vec2(.03+uvScreen.x*.94,.08+uvScreen.y*.84)+n*.009;
  vec3 photo=texture2D(waterPhoto,photoUv).rgb;
  float luminance=dot(photo,vec3(.2126,.7152,.0722));
  float surface=texture2D(heightMap,q*.70+n*.016+vec2(clockTime*.002,0.)).r;
  vec3 water=mix(vec3(.899,.946,.927),waterTint,.40);
  water+=vec3(1.)*(luminance-.42)*.13*textureReady;
  water+=vec3(.014,.018,.016)*(surface-.5);
  water+=vec3(.028,.035,.032)*sin(q.x*2.5+q.y*3.+clockTime*.11);
  // Bright shallow edge, then a gentle increase in depth. No black or navy lighting.
  water=mix(vec3(.938,.970,.957),water,smoothstep(0.,100.,depth));
  water+=vec3(1.)*ripple*.075;
  water-=vec3(.25,.37,.33)*gaussian(depth-6.,3.)*.06;
  vec3 col=mix(paper,water-vec3(.035,.025,.03),wet);
  col+=vec3(1.)*gaussian(depth,1.05)*.075;
  col-=vec3(.18,.31,.27)*gaussian(depth+2.4,1.8)*.23;
  col+=vec3(1.)*gaussian(depth-12.,9.)*.020;
  col-=vec3(.37,.48,.43)*rain;
  col+=vec3(1.)*rainShine*.24;
  // Very soft sunlight across the entire application, including the navigation.
  float sunlight=pow(max(0.,sin((uvScreen.x+uvScreen.y*.3)*5.6)),12.);
  col+=vec3(.010,.012,.010)*sunlight;
  float alpha=clamp(wet*.48 + gaussian(depth,2.)*.28 + rain*.95 + abs(ripple)*.25,0.,.68);
  gl_FragColor=vec4(clamp(col-rain*.4,0.,1.),alpha);
}`;

/** A single viewport-wide water surface. Only main-process time controls the level. */
export function Tank({
  snapshot,
  appearance,
}: {
  snapshot: Snapshot;
  appearance: Appearance;
}) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ snapshot, appearance });
  state.current = { snapshot, appearance };
  const [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch {
      setError(true);
      return;
    }
    setError(false);
    el.appendChild(renderer.domElement);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene(),
      camera = new THREE.Camera();
    const drops = Array.from(
      { length: 24 },
      () => new THREE.Vector4(0, 0, -100, 1),
    );
    const placeholder = new THREE.DataTexture(
      new Uint8Array([128, 128, 255, 255]),
      1,
      1,
    );
    placeholder.needsUpdate = true;
    const uniforms = {
      resolution: { value: new THREE.Vector2(1, 1) },
      clockTime: { value: 0 },
      fillLevel: { value: 0.025 },
      rainEnabled: { value: 0 },
      textureReady: { value: 0 },
      waterTint: { value: new THREE.Vector3(0.87, 0.94, 0.91) },
      waterPhoto: { value: placeholder as THREE.Texture },
      normalMap: { value: placeholder as THREE.Texture },
      heightMap: { value: placeholder as THREE.Texture },
      drops: { value: drops },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, material));
    let disposed = false,
      lost = false,
      raf = 0,
      visualTime = 0,
      nextDrop = 0.35,
      index = 0,
      loaded = 0;
    let lastDraw = performance.now(),
      lastReceived = lastDraw,
      lastSeq = -1,
      lastSession = "",
      lastKey = "",
      quality = "";
    const textures: THREE.Texture[] = [];
    const metrics: Metrics = {
      frames: 0,
      frameHistogram: Array.from({ length: 501 }, () => 0),
      dropEvents: 0,
      rainCount: 0,
      drawCalls: 0,
      triangles: 0,
      frameMs: [],
      progress: 0,
      textureReady: false,
      visualTime: 0,
    };
    window.tankMetrics = metrics;
    const loader = new THREE.TextureLoader();
    for (const [key, file] of [
      ["waterPhoto", "sunlit-water.jpg"],
      ["normalMap", "surface-normal.png"],
      ["heightMap", "surface-height.png"],
    ] as const) {
      const texture = loader.load(
        `./assets/Water/${file}`,
        () => {
          if (disposed) {
            texture.dispose();
            return;
          }
          loaded++;
          uniforms.textureReady.value = loaded === 3 ? 1 : 0;
          metrics.textureReady = loaded === 3;
          lastKey = "";
        },
        undefined,
        () => {
          if (!disposed) el.dataset.texture = "unavailable";
        },
      );
      texture.wrapS = texture.wrapT =
        key === "waterPhoto" ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      uniforms[key].value = texture;
      textures.push(texture);
    }
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      uniforms.resolution.value.set(el.clientWidth, el.clientHeight);
      lastKey = "";
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const contextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(raf);
      metrics.rainCount = 0;
      setError(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    const render = () => {
      if (disposed || lost || document.hidden) return;
      raf = requestAnimationFrame(render);
      const now = performance.now(),
        { snapshot: s, appearance: a } = state.current;
      const elapsed = now - lastDraw;
      if (elapsed < 1000 / (a.quality === "low" ? 30 : 60) - 0.5) return;
      const dt = Math.min(elapsed / 1000, 0.08);
      lastDraw = now;
      if (quality !== a.quality) {
        quality = a.quality;
        renderer.setPixelRatio(
          Math.min(
            devicePixelRatio,
            a.quality === "low" ? 1 : a.quality === "medium" ? 1.25 : 1.5,
          ),
        );
        resize();
      }
      if (s.snapshotSeq !== lastSeq) {
        lastSeq = s.snapshotSeq;
        lastReceived = now;
      }
      const running = s.phase === "running" && now - lastReceived < 1500;
      const session = s.session?.id ?? "";
      if (session !== lastSession) {
        lastSession = session;
        visualTime = 0;
        nextDrop = 0.35;
        drops.forEach((d) => (d.z = -100));
        index = 0;
      }
      const progress = Math.min(
        1,
        Math.max(0, (s.session?.effectiveMs ?? 0) / (s.session?.targetMs ?? 1)),
      );
      uniforms.fillLevel.value = 0.025 + progress * 0.925;
      metrics.progress = progress;
      if (running && !a.lowMotion) visualTime += dt;
      uniforms.clockTime.value = visualTime;
      uniforms.rainEnabled.value = running && !a.lowMotion ? 1 : 0;
      if (running && !a.lowMotion && visualTime >= nextDrop) {
        // Visual-only rain; the main process controls earned time.
        const x = (0.083 + index * 0.61803398875) % 1;
        drops[index % 24].set(
          x,
          8 + ((index * 17) % 34),
          visualTime,
          0.8 + (index % 3) * 0.12,
        );
        index++;
        metrics.dropEvents++;
        nextDrop = visualTime + 0.25 + Math.random() * 0.06;
      }
      metrics.rainCount =
        running && !a.lowMotion
          ? drops.filter((d) => visualTime >= d.z && visualTime < d.z + d.w)
              .length
          : 0;
      metrics.visualTime = visualTime;
      uniforms.waterTint.value.set(
        ...((a.theme === "tea"
          ? [0.947, 0.921, 0.867]
          : a.theme === "lake"
            ? [0.861, 0.928, 0.961]
            : [0.87, 0.943, 0.914]) as [number, number, number]),
      );
      const staticKey = `${progress}|${s.phase}|${running}|${a.theme}|${a.lowMotion}|${a.quality}|${loaded}|${el.clientWidth}|${el.clientHeight}`;
      if ((!running || a.lowMotion) && staticKey === lastKey) return;
      lastKey = staticKey;
      renderer.render(scene, camera);
      metrics.frames++;
      metrics.frameHistogram[Math.min(500, Math.round(elapsed))]++;
      metrics.drawCalls = renderer.info.render.calls;
      metrics.triangles = renderer.info.render.triangles;
      if (metrics.frameMs.length < 3600) metrics.frameMs.push(elapsed);
      else metrics.frameMs[metrics.frames % 3600] = elapsed;
    };
    const visibility = () => {
      cancelAnimationFrame(raf);
      lastDraw = performance.now();
      lastKey = "";
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
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      textures.forEach((t) => t.dispose());
      placeholder.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [attempt]);
  return (
    <>
      <div
        className="app-water"
        ref={host}
        aria-hidden="true"
        data-testid="app-water"
      />
      {error && (
        <div className="water-compat" role="status">
          <span>当前处于兼容模式 · 学习计时正常</span>
          <button onClick={() => setAttempt((v) => v + 1)}>重试水面</button>
        </div>
      )}
    </>
  );
}
