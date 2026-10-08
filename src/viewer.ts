import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { assetUrl, pointCount } from './data';
import type { Quality, Tree } from './types';

export class TreeViewer {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, .05, 1000);
  private controls: OrbitControls | null = null;
  private cloud: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private grid: THREE.GridHelper | null = null;
  private controller: AbortController | null = null;
  private revision = 0;
  private disposed = false;
  private observer: ResizeObserver;
  private sourceColors: Float32Array | null = null;
  private colorMode = 'rgb';
  private size = 2;
  private rotating = false;
  private fallback: HTMLImageElement;
  private status: HTMLElement;
  private badge: HTMLElement;
  private current: Tree | null = null;
  private quality: Quality = 'high';
  public available = false;

  constructor(private host: HTMLElement) {
    this.host.innerHTML = '<img class="viewer-fallback" alt="树木点云预览" hidden /><div class="viewer-status" role="status" aria-live="polite"></div><div class="viewer-cloud-badge"></div><div class="viewer-instruction">拖动旋转 · 滚轮缩放 · 右键平移</div><div class="viewer-axis"><span>Z ↑</span><span>地面 XY</span></div>';
    this.fallback = this.host.querySelector<HTMLImageElement>('.viewer-fallback')!;
    this.status = this.host.querySelector<HTMLElement>('.viewer-status')!;
    this.badge = this.host.querySelector<HTMLElement>('.viewer-cloud-badge')!;
    this.scene.background = new THREE.Color('#edf1e9');
    this.camera.up.set(0, 0, 1);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.domElement.setAttribute('aria-label', '树木三维点云，可拖动旋转、缩放和平移');
      this.renderer.domElement.setAttribute('role', 'img');
      this.host.prepend(this.renderer.domElement);
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.minDistance = .5;
      this.controls.maxDistance = 150;
      this.controls.autoRotateSpeed = .7;
      this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
      this.renderer.setAnimationLoop(() => {
        if (this.disposed) return;
        this.controls?.update();
        this.renderer?.render(this.scene, this.camera);
      });
      this.available = true;
    } catch {
      this.showFallback('当前浏览器无法开启三维显示，已切换为点云图片。');
    }
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.available = false;
    this.renderer?.setAnimationLoop(null);
    this.controller?.abort();
    this.revision++;
    this.clearCloud();
    this.showFallback('三维显示已中断，请重新打开三维浏览；参数和图片仍可查看。');
  };

  private resize() {
    if (!this.renderer) return;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private clearCloud() {
    if (this.cloud) {
      this.scene.remove(this.cloud);
      this.cloud.geometry.dispose();
      this.cloud.material.dispose();
      this.cloud = null;
    }
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      const materials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
      materials.forEach((m) => m.dispose());
      this.grid = null;
    }
    this.sourceColors = null;
  }

  private showFallback(message: string, retry = false) {
    this.fallback.hidden = false;
    if (this.renderer) this.renderer.domElement.hidden = true;
    this.status.className = 'viewer-status is-error';
    this.status.textContent = message;
    if (retry) {
      const button = document.createElement('button');
      button.className = 'button small';
      button.textContent = '重新加载';
      button.addEventListener('click', () => this.current && this.load(this.current, this.quality));
      this.status.append(button);
    }
    this.badge.textContent = '点云图片预览';
  }

  public async load(tree: Tree, quality: Quality) {
    const revision = ++this.revision;
    this.controller?.abort();
    this.current = tree;
    this.quality = quality;
    this.clearCloud();
    delete this.host.dataset.loadedTree;
    delete this.host.dataset.loadedQuality;
    this.fallback.src = assetUrl(tree.thumbnail);
    this.fallback.alt = `树木 ${tree.id} 的真实点云预览`;
    this.badge.textContent = '';
    if (!this.available) {
      this.showFallback('当前无法开启三维显示，已切换为点云图片。');
      return;
    }
    this.fallback.hidden = false;
    this.renderer!.domElement.hidden = true;
    this.status.className = 'viewer-status is-loading';
    this.status.textContent = '正在载入三维点云…';
    this.controller = new AbortController();
    const controller = this.controller;
    try {
      const response = await fetch(assetUrl(tree.models[quality].path), { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const expected = Number(response.headers.get('content-length')) || tree.models[quality].bytes;
      let bytes: ArrayBuffer;
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (revision !== this.revision || this.disposed) { await reader.cancel(); return; }
          this.status.textContent = `正在载入三维点云 ${Math.min(100, Math.round(received / expected * 100))}%`;
        }
        const merged = new Uint8Array(received);
        let cursor = 0;
        for (const chunk of chunks) { merged.set(chunk, cursor); cursor += chunk.byteLength; }
        bytes = merged.buffer;
      } else bytes = await response.arrayBuffer();
      if (revision !== this.revision || this.disposed) return;
      const geometry = new PLYLoader().parse(bytes);
      if (!geometry.getAttribute('position')?.count) { geometry.dispose(); throw new Error('Empty geometry'); }
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const colors = geometry.getAttribute('color');
      // PLYLoader may return normalized Uint8 attributes. Attribute accessors
      // preserve that normalization; copying the raw array would turn 0..255
      // into overflowing floating-point colors and wash the tree out to white.
      this.sourceColors = colors ? new Float32Array(colors.count * 3) : null;
      if (colors && this.sourceColors) {
        for (let i = 0; i < colors.count; i++) {
          this.sourceColors[i * 3] = colors.getX(i);
          this.sourceColors[i * 3 + 1] = colors.getY(i);
          this.sourceColors[i * 3 + 2] = colors.getZ(i);
        }
      }
      const material = new THREE.PointsMaterial({ vertexColors: true, size: this.size, sizeAttenuation: false });
      this.cloud = new THREE.Points(geometry, material);
      this.scene.add(this.cloud);
      const box = geometry.boundingBox!;
      const extent = box.getSize(new THREE.Vector3());
      const gridSize = Math.ceil(Math.max(extent.x, extent.y, 6) / 2) * 2 + 4;
      this.grid = new THREE.GridHelper(gridSize, 12, '#bcccb8', '#d4ded0');
      this.grid.rotation.x = Math.PI / 2;
      this.grid.position.z = box.min.z - .05;
      const materials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
      materials.forEach((m) => { m.transparent = true; m.opacity = .55; });
      this.scene.add(this.grid);
      this.applyColor();
      this.reset();
      this.controls!.autoRotate = this.rotating;
      this.status.className = 'viewer-status';
      this.status.textContent = '';
      this.fallback.hidden = true;
      this.renderer!.domElement.hidden = false;
      this.badge.textContent = `${quality === 'lite' ? '轻量' : '清晰'} · ${pointCount(geometry.getAttribute('position').count)} 个展示点`;
      this.host.dataset.loadedTree = tree.id;
      this.host.dataset.loadedQuality = quality;
    } catch (error) {
      if (revision !== this.revision || this.disposed || (error instanceof DOMException && error.name === 'AbortError')) return;
      this.clearCloud();
      this.showFallback('点云加载失败，图片和参数仍可查看。', true);
    }
  }

  public reset() {
    if (!this.cloud || !this.controls) return;
    const box = this.cloud.geometry.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    const extent = box.getSize(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const limitingFov = Math.min(verticalFov, 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect));
    const radius = this.cloud.geometry.boundingSphere!.radius;
    const distance = radius / Math.sin(limitingFov / 2) * 1.12;
    this.camera.position.copy(center).add(new THREE.Vector3(1, -1.55, .55).normalize().multiplyScalar(distance));
    this.camera.near = Math.max(.01, distance / 1000);
    this.camera.far = Math.max(300, distance * 10);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.maxDistance = Math.max(150, distance * 3);
    this.controls.minDistance = Math.max(.5, extent.z * .08);
    this.controls.update();
  }

  public setSize(size: number) { this.size = size; if (this.cloud) this.cloud.material.size = size; }
  public setRotating(rotating: boolean) { this.rotating = rotating; if (this.controls) this.controls.autoRotate = rotating; }
  public setColorMode(mode: string) { this.colorMode = mode; this.applyColor(); }

  private applyColor() {
    if (!this.cloud) return;
    const geometry = this.cloud.geometry;
    const positions = geometry.getAttribute('position');
    let colors: Float32Array;
    if (this.colorMode === 'rgb' && this.sourceColors) colors = new Float32Array(this.sourceColors);
    else {
      colors = new Float32Array(positions.count * 3);
      const box = geometry.boundingBox!;
      const range = Math.max(.001, box.max.z - box.min.z);
      const color = new THREE.Color();
      for (let i = 0; i < positions.count; i++) {
        const t = (positions.getZ(i) - box.min.z) / range;
        color.setHSL(.48 - t * .36, .65, .33 + t * .12);
        color.toArray(colors, i * 3);
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  public dispose() {
    this.disposed = true;
    this.revision++;
    this.controller?.abort();
    this.observer.disconnect();
    this.controls?.dispose();
    this.renderer?.setAnimationLoop(null);
    this.clearCloud();
    if (this.renderer) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    this.host.replaceChildren();
  }
}
