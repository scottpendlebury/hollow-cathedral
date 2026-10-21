/**
 * GeoBatch.js — static geometry batching.
 *
 * A gothic cathedral is thousands of boxes. Rendering them as individual
 * meshes would cost hundreds of draw calls and tank mobile performance, so
 * static level geometry is accumulated per material and merged into a single
 * buffer at the end.
 *
 * Textures are mapped in world space: every vertex's UV is derived from its
 * final world position, projected onto the plane of its face normal. That
 * keeps texel density consistent no matter how a piece was scaled, and needs
 * only one texture repeat per material.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

export class GeoBatch {
  /**
   * @param {number} tile world units covered by one texture repeat
   */
  constructor(tile = 2.5) {
    this.tile = tile;
    this.buckets = new Map();
    this.extras = [];
  }

  _bucket(material) {
    let list = this.buckets.get(material);
    if (!list) {
      list = [];
      this.buckets.set(material, list);
    }
    return list;
  }

  /**
   * Adds a raw geometry with a transform.
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Matrix4} matrix
   * @param {THREE.Material} material
   */
  addGeometry(geometry, matrix, material) {
    const g = geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    this._applyWorldUV(g);
    this._bucket(material).push(this._normalise(g));
  }

  /**
   * Merging requires every geometry to agree on whether it is indexed, so
   * everything is converted to non-indexed form. The extra vertices cost
   * little compared with the draw calls saved.
   */
  _normalise(geometry) {
    let g = geometry;
    if (g.index) {
      const flat = g.toNonIndexed();
      g.dispose();
      g = flat;
    }
    // Merging also requires an identical attribute set, so drop anything
    // that is not position/normal/uv and make sure the basics are present.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') {
        g.deleteAttribute(name);
      }
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    g.clearGroups();
    return g;
  }

  /**
   * Adds an object (and its children) to the batch. Meshes are flattened into
   * world space using the object's own world matrix.
   * @param {THREE.Object3D} root
   */
  add(root) {
    root.updateWorldMatrix(true, true);
    root.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      const g = child.geometry.clone();
      g.applyMatrix4(child.matrixWorld);
      this._applyWorldUV(g);
      this._bucket(child.material).push(this._normalise(g));
    });
  }

  /**
   * Keeps a mesh out of the batch (for animated or interactive pieces).
   */
  addSeparate(object3D) {
    this.extras.push(object3D);
  }

  /**
   * Rewrites UVs so that the texture tiles in world space.
   */
  _applyWorldUV(geometry) {
    const pos = geometry.attributes.position;
    if (!pos) return;
    const nrm = geometry.attributes.normal;
    if (!nrm) geometry.computeVertexNormals();
    const count = pos.count;
    let uv = geometry.attributes.uv;
    if (!uv || uv.count !== count) {
      uv = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
      geometry.setAttribute('uv', uv);
    }
    const inv = 1 / this.tile;
    for (let i = 0; i < count; i++) {
      _v.fromBufferAttribute(pos, i);
      _n.fromBufferAttribute(geometry.attributes.normal, i);
      const ax = Math.abs(_n.x);
      const ay = Math.abs(_n.y);
      const az = Math.abs(_n.z);
      let u;
      let v;
      if (ay >= ax && ay >= az) {
        u = _v.x * inv;
        v = _v.z * inv;
      } else if (ax >= az) {
        u = _v.z * inv;
        v = _v.y * inv;
      } else {
        u = _v.x * inv;
        v = _v.y * inv;
      }
      uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;
  }

  /**
   * Merges each bucket and adds the resulting meshes to the parent.
   * @param {THREE.Object3D} parent
   * @returns {THREE.Mesh[]} the created meshes
   */
  build(parent) {
    const created = [];
    for (const [material, geometries] of this.buckets) {
      if (!geometries.length) continue;
      let merged = null;
      try {
        merged = mergeGeometries(geometries, false);
      } catch (err) {
        merged = null;
      }
      if (!merged) {
        // Fall back to individual meshes if merging fails for any reason.
        for (const g of geometries) {
          const m = new THREE.Mesh(g, material);
          parent.add(m);
          created.push(m);
        }
        continue;
      }
      for (const g of geometries) g.dispose();
      const mesh = new THREE.Mesh(merged, material);
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      created.push(mesh);
    }
    this.buckets.clear();
    for (const e of this.extras) parent.add(e);
    this.extras.length = 0;
    return created;
  }
}
