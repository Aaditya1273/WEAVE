// LiquidMetal — Code component template (Paper-derived WebGL shader: chrome surface with banded reflections; uploads become liquid chrome).
//
// The __PAPER block is a generated esbuild bundle of GLSL + helpers vendored
// from paper-design/shaders (Apache-2.0, https://github.com/paper-design/shaders).
// Regenerate it with the vendor bake rather than hand-editing. The mount and
// wrapper below it are ours and follow the standard code-component shape:
// useStaticCanvas() renders a paint-once frame on the editor canvas; preview
// and the published site run the animated WebGL2 version.

export const LIQUID_METAL_COMPONENT = `'use client';

/** @label "Liquid Metal" */
/** @comment "Liquid chrome surface with banded reflections and chromatic edges. Upload your own logo or image and it becomes flowing metal. Animates in preview and on the live site." */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @controls {
  "image": { "type": "upload", "label": "Image", "default": "", "accept": "image/*" },
  "shape": { "type": "select", "label": "Shape (no image)", "default": "diamond", "options": [{"label":"Diamond","value":"diamond"},{"label":"Circle","value":"circle"},{"label":"Daisy","value":"daisy"},{"label":"Metaballs","value":"metaballs"}] },
  "colorBack": { "type": "color", "label": "Background", "default": "#AAAAAC" },
  "colorTint": { "type": "color", "label": "Tint", "default": "#ffffff" },
  "distortion": { "type": "number", "label": "Distortion", "min": 0, "max": 0.5, "step": 0.01, "default": 0.07 },
  "repetition": { "type": "number", "label": "Repetition", "min": 1, "max": 10, "step": 0.5, "default": 2 },
  "shiftRed": { "type": "number", "label": "Red shift", "min": -1, "max": 1, "step": 0.05, "default": 0.3 },
  "shiftBlue": { "type": "number", "label": "Blue shift", "min": -1, "max": 1, "step": 0.05, "default": 0.3 },
  "contour": { "type": "number", "label": "Contour", "min": 0, "max": 1, "step": 0.05, "default": 0.4 },
  "softness": { "type": "number", "label": "Softness", "min": 0, "max": 1, "step": 0.05, "default": 0.1 },
  "angle": { "type": "number", "label": "Angle", "min": 0, "max": 360, "step": 1, "default": 70 },
  "scale": { "type": "number", "label": "Zoom", "min": 0.1, "max": 3, "step": 0.05, "default": 0.6 },
  "speed": { "type": "number", "label": "Speed", "min": 0, "max": 3, "step": 0.1, "default": 1 }
} */

import React, { useEffect, useRef } from 'react';
import { withResponsiveProps, useStaticCanvas } from '@revyme/runtime';

// ─── Vendored engine — paper-design/shaders (Apache-2.0) ───
// https://github.com/paper-design/shaders — generated bundle, do not hand-edit.
var __PAPER = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // entries/liquid-metal.js
  var liquid_metal_exports = {};
  __export(liquid_metal_exports, {
    fragmentShader: () => liquidMetalFragmentShader,
    processImage: () => toProcessedLiquidMetal,
    shapes: () => LiquidMetalShapes,
    vertexShaderSource: () => vertexShaderSource
  });

  // ../paper-shaders/packages/shaders/src/shader-utils.ts
  var declarePI = \`
#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846
\`;
  var rotation2 = \`
vec2 rotate(vec2 uv, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}
\`;
  var colorBandingFix = \`
  color += 1. / 256. * (fract(sin(dot(.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123) - .5);
\`;
  var simplexNoise = \`
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
    -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
      dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
\`;

  // ../paper-shaders/packages/shaders/src/shaders/liquid-metal.ts
  var liquidMetalFragmentShader = \`#version 300 es
precision mediump float;

uniform sampler2D u_image;

uniform vec2 u_resolution;
uniform float u_time;

uniform vec4 u_colorBack;
uniform vec4 u_colorTint;

uniform float u_softness;
uniform float u_repetition;
uniform float u_shiftRed;
uniform float u_shiftBlue;
uniform float u_distortion;
uniform float u_contour;
uniform float u_angle;

uniform float u_shape;
uniform bool u_isImage;

in vec2 v_objectUV;
in vec2 v_responsiveUV;
in vec2 v_responsiveBoxGivenSize;
in vec2 v_imageUV;

out vec4 fragColor;

\${declarePI}
\${rotation2}
\${simplexNoise}

float getColorChanges(float c1, float c2, float stripe_p, vec3 w, float blur, float bump, float tint) {

  float ch = mix(c2, c1, smoothstep(.0, 2. * blur, stripe_p));

  float border = w[0];
  ch = mix(ch, c2, smoothstep(border, border + 2. * blur, stripe_p));

  if (u_isImage == true) {
    bump = smoothstep(.2, .8, bump);
  }
  border = w[0] + .4 * (1. - bump) * w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2. * blur, stripe_p));

  border = w[0] + .5 * (1. - bump) * w[1];
  ch = mix(ch, c2, smoothstep(border, border + 2. * blur, stripe_p));

  border = w[0] + w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2. * blur, stripe_p));

  float gradient_t = (stripe_p - w[0] - w[1]) / w[2];
  float gradient = mix(c1, c2, smoothstep(0., 1., gradient_t));
  ch = mix(ch, gradient, smoothstep(border, border + .5 * blur, stripe_p));

  // Tint color is applied with color burn blending
  ch = mix(ch, 1. - min(1., (1. - ch) / max(tint, 0.0001)), u_colorTint.a);
  return ch;
}

float getImgFrame(vec2 uv, float th) {
  float frame = 1.;
  frame *= smoothstep(0., th, uv.y);
  frame *= 1.0 - smoothstep(1. - th, 1., uv.y);
  frame *= smoothstep(0., th, uv.x);
  frame *= 1.0 - smoothstep(1. - th, 1., uv.x);
  return frame;
}

float blurEdge3x3(sampler2D tex, vec2 uv, vec2 dudx, vec2 dudy, float radius, float centerSample) {
  vec2 texel = 1.0 / vec2(textureSize(tex, 0));
  vec2 r = radius * texel;

  float w1 = 1.0, w2 = 2.0, w4 = 4.0;
  float norm = 16.0;
  float sum = w4 * centerSample;

  sum += w2 * textureGrad(tex, uv + vec2(0.0, -r.y), dudx, dudy).r;
  sum += w2 * textureGrad(tex, uv + vec2(0.0, r.y), dudx, dudy).r;
  sum += w2 * textureGrad(tex, uv + vec2(-r.x, 0.0), dudx, dudy).r;
  sum += w2 * textureGrad(tex, uv + vec2(r.x, 0.0), dudx, dudy).r;

  sum += w1 * textureGrad(tex, uv + vec2(-r.x, -r.y), dudx, dudy).r;
  sum += w1 * textureGrad(tex, uv + vec2(r.x, -r.y), dudx, dudy).r;
  sum += w1 * textureGrad(tex, uv + vec2(-r.x, r.y), dudx, dudy).r;
  sum += w1 * textureGrad(tex, uv + vec2(r.x, r.y), dudx, dudy).r;

  return sum / norm;
}

float lst(float edge0, float edge1, float x) {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}

void main() {

  const float firstFrameOffset = 2.8;
  float t = .3 * (u_time + firstFrameOffset);

  vec2 uv = v_imageUV;
  vec2 dudx = dFdx(v_imageUV);
  vec2 dudy = dFdy(v_imageUV);
  vec4 img = textureGrad(u_image, uv, dudx, dudy);

  if (u_isImage == false) {
    uv = v_objectUV + .5;
    uv.y = 1. - uv.y;
  }

  float cycleWidth = u_repetition;
  float edge = 0.;
  float contOffset = 1.;

  vec2 rotatedUV = uv - vec2(.5);
  float angle = (-u_angle + 70.) * PI / 180.;
  float cosA = cos(angle);
  float sinA = sin(angle);
  rotatedUV = vec2(
  rotatedUV.x * cosA - rotatedUV.y * sinA,
  rotatedUV.x * sinA + rotatedUV.y * cosA
  ) + vec2(.5);

  // u_contour is applied in 2 separate ranges:
  // - 0 to .4 sets the edge hardness, saturated above .4 (both branches below)
  // - .5 to 1 warps the stripes direction along the edges, inactive below .5 (see u_contour range 2)
  if (u_isImage == true) {
    float edgeRaw = img.r;
    edge = blurEdge3x3(u_image, uv, dudx, dudy, 6., edgeRaw);
    edge = pow(edge, 1.6);
    edge *= mix(0.0, 1.0, smoothstep(0.0, 0.4, u_contour));
  } else {
    if (u_shape < 1.) {
      // full-fill on canvas
      vec2 borderUV = v_responsiveUV + .5;
      float ratio = v_responsiveBoxGivenSize.x / v_responsiveBoxGivenSize.y;
      vec2 mask = min(borderUV, 1. - borderUV);
      vec2 pixel_thickness = min(250. / v_responsiveBoxGivenSize, vec2(.5));
      float maskX = smoothstep(0.0, pixel_thickness.x, mask.x);
      float maskY = smoothstep(0.0, pixel_thickness.y, mask.y);
      maskX = pow(maskX, .25);
      maskY = pow(maskY, .25);
      edge = clamp(1. - maskX * maskY, 0., 1.);

      uv = v_responsiveUV;
      if (ratio > 1.) {
        uv.y /= ratio;
      } else {
        uv.x *= ratio;
      }
      uv += .5;
      uv.y = 1. - uv.y;

      cycleWidth *= 2.;
      contOffset = 1.5;

    } else if (u_shape < 2.) {
      // circle
      vec2 shapeUV = uv - .5;
      shapeUV *= .67;
      edge = pow(clamp(3. * length(shapeUV), 0., 1.), 18.);
    } else if (u_shape < 3.) {
      // daisy
      vec2 shapeUV = uv - .5;
      shapeUV *= 1.68;

      float r = length(shapeUV) * 2.;
      float a = atan(shapeUV.y, shapeUV.x) + .2;
      r *= (1. + .05 * sin(3. * a + 2. * t));
      float f = abs(cos(a * 3.));
      edge = smoothstep(f, f + .7, r);
      edge *= edge;

      uv *= .8;
      cycleWidth *= 1.6;

    } else if (u_shape < 4.) {
      // diamond
      vec2 shapeUV = uv - .5;
      shapeUV = rotate(shapeUV, .25 * PI);
      shapeUV *= 1.42;
      shapeUV += .5;
      vec2 mask = min(shapeUV, 1. - shapeUV);
      vec2 pixel_thickness = vec2(.15);
      float maskX = smoothstep(0.0, pixel_thickness.x, mask.x);
      float maskY = smoothstep(0.0, pixel_thickness.y, mask.y);
      maskX = pow(maskX, .25);
      maskY = pow(maskY, .25);
      edge = clamp(1. - maskX * maskY, 0., 1.);
    } else if (u_shape < 5.) {
      // metaballs
      vec2 shapeUV = uv - .5;
      shapeUV *= 1.3;
      edge = 0.;
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float speed = 1.5 + 2./3. * sin(fi * 12.345);
        float angle = -fi * 1.5;
        vec2 dir1 = vec2(cos(angle), sin(angle));
        vec2 dir2 = vec2(cos(angle + 1.57), sin(angle + 1.));
        vec2 traj = .4 * (dir1 * sin(t * speed + fi * 1.23) + dir2 * cos(t * (speed * 0.7) + fi * 2.17));
        float d = length(shapeUV + traj);
        edge += pow(1.0 - clamp(d, 0.0, 1.0), 4.0);
      }
      edge = 1. - smoothstep(.65, .9, edge);
      edge = pow(edge, 4.);
    }

    edge = mix(smoothstep(.9 - 2. * fwidth(edge), .9, edge), edge, smoothstep(0.0, 0.4, u_contour));

  }

  float opacity = 0.;
  if (u_isImage == true) {
    opacity = img.g;
    float frame = getImgFrame(v_imageUV, 0.);
    opacity *= frame;
  } else {
    opacity = 1. - smoothstep(.9 - 2. * fwidth(edge), .9, edge);
    if (u_shape < 2.) {
      edge = 1.2 * edge;
    } else if (u_shape < 5.) {
      edge = 1.8 * pow(edge, 1.5);
    }
  }

  float diagBLtoTR = rotatedUV.x - rotatedUV.y;
  float diagTLtoBR = rotatedUV.x + rotatedUV.y;

  vec3 color = vec3(0.);
  vec3 color1 = vec3(.98, 0.98, 1.);
  vec3 color2 = vec3(.1, .1, .1 + .1 * smoothstep(.7, 1.3, diagTLtoBR));

  vec2 grad_uv = uv - .5;

  float dist = length(grad_uv + vec2(0., .2 * diagBLtoTR));
  grad_uv = rotate(grad_uv, (.25 - .2 * diagBLtoTR) * PI);
  float direction = grad_uv.x;

  float bump = pow(1.8 * dist, 1.2);
  bump = 1. - bump;
  bump *= pow(uv.y, .3);


  float thin_strip_1_ratio = .12 / cycleWidth * (1. - .4 * bump);
  float thin_strip_2_ratio = .07 / cycleWidth * (1. + .4 * bump);
  float wide_strip_ratio = (1. - thin_strip_1_ratio - thin_strip_2_ratio);

  float thin_strip_1_width = cycleWidth * thin_strip_1_ratio;
  float thin_strip_2_width = cycleWidth * thin_strip_2_ratio;

  float noise = snoise(uv - t);

  edge += (1. - edge) * u_distortion * noise;

  direction += diagBLtoTR;
  float contour = 0.;
  direction -= 2. * noise * diagBLtoTR * (smoothstep(0., 1., edge) * (1.0 - smoothstep(0., 1., edge)));
  // u_contour range 2
  direction *= mix(1., 1. - edge, smoothstep(.5, 1., u_contour));
  direction -= 1.7 * edge * smoothstep(.5, 1., u_contour);
  direction += .2 * pow(u_contour, 4.) * (1.0 - smoothstep(0., 1., edge));

  bump *= clamp(pow(uv.y, .1), .3, 1.);
  direction *= (.1 + (1.1 - edge) * bump);

  direction *= (.4 + .6 * (1.0 - smoothstep(.5, 1., edge)));
  direction += .18 * (smoothstep(.1, .2, uv.y) * (1.0 - smoothstep(.2, .4, uv.y)));
  direction += .03 * (smoothstep(.1, .2, 1. - uv.y) * (1.0 - smoothstep(.2, .4, 1. - uv.y)));

  direction *= (.5 + .5 * pow(uv.y, 2.));
  direction *= cycleWidth;
  direction -= t;


  float colorDispersion = (1. - bump);
  colorDispersion = clamp(colorDispersion, 0., 1.);
  float dispersionRed = colorDispersion;
  dispersionRed += .03 * bump * noise;
  dispersionRed += 5. * (smoothstep(-.1, .2, uv.y) * (1.0 - smoothstep(.1, .5, uv.y))) * (smoothstep(.4, .6, bump) * (1.0 - smoothstep(.4, 1., bump)));
  dispersionRed -= diagBLtoTR;

  float dispersionBlue = colorDispersion;
  dispersionBlue *= 1.3;
  dispersionBlue += (smoothstep(0., .4, uv.y) * (1.0 - smoothstep(.1, .8, uv.y))) * (smoothstep(.4, .6, bump) * (1.0 - smoothstep(.4, .8, bump)));
  dispersionBlue -= .2 * edge;

  dispersionRed *= (u_shiftRed / 20.);
  dispersionBlue *= (u_shiftBlue / 20.);

  float blur = 0.;
  float rExtraBlur = 0.;
  float gExtraBlur = 0.;
  if (u_isImage == true) {
    float softness = 0.05 * u_softness;
    blur = softness + .5 * smoothstep(1., 10., u_repetition) * smoothstep(.0, 1., edge);
    float smallCanvasT = 1.0 - smoothstep(100., 500., min(u_resolution.x, u_resolution.y));
    blur += smallCanvasT * smoothstep(.0, 1., edge);
    rExtraBlur = softness * (0.05 + .1 * (u_shiftRed / 20.) * bump);
    gExtraBlur = softness * 0.05 / max(0.001, abs(1. - diagBLtoTR));
  } else {
    blur = u_softness / 15. + .3 * contour;
  }

  vec3 w = vec3(thin_strip_1_width, thin_strip_2_width, wide_strip_ratio);
  w[1] -= .02 * smoothstep(.0, 1., edge + bump);
  float stripe_r = fract(direction + dispersionRed);
  float r = getColorChanges(color1.r, color2.r, stripe_r, w, blur + fwidth(stripe_r) + rExtraBlur, bump, u_colorTint.r);
  float stripe_g = fract(direction);
  float g = getColorChanges(color1.g, color2.g, stripe_g, w, blur + fwidth(stripe_g) + gExtraBlur, bump, u_colorTint.g);
  float stripe_b = fract(direction - dispersionBlue);
  float b = getColorChanges(color1.b, color2.b, stripe_b, w, blur + fwidth(stripe_b), bump, u_colorTint.b);

  color = vec3(r, g, b);
  color *= opacity;

  vec3 bgColor = u_colorBack.rgb * u_colorBack.a;
  color = color + bgColor * (1. - opacity);
  opacity = opacity + u_colorBack.a * (1. - opacity);

  \${colorBandingFix}

  fragColor = vec4(color, opacity);
}
\`;
  var POISSON_CONFIG_OPTIMIZED = {
    measurePerformance: false,
    // Set to true to see performance metrics
    workingSize: 512,
    // Size to solve Poisson at (will upscale to original size)
    iterations: 40
    // SOR converges ~2-20x faster than standard Gauss-Seidel
  };
  function toProcessedLiquidMetal(file) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const isBlob = typeof file === "string" && file.startsWith("blob:");
    return new Promise((resolve, reject) => {
      if (!file || !ctx) {
        reject(new Error("Invalid file or canvas context"));
        return;
      }
      const blobContentTypePromise = isBlob && fetch(file).then((res) => res.headers.get("Content-Type"));
      const img = new Image();
      img.crossOrigin = "anonymous";
      const totalStartTime = performance.now();
      img.onload = async () => {
        let isSVG;
        const blobContentType = await blobContentTypePromise;
        if (blobContentType) {
          isSVG = blobContentType === "image/svg+xml";
        } else if (typeof file === "string") {
          isSVG = file.endsWith(".svg") || file.startsWith("data:image/svg+xml");
        } else {
          isSVG = file.type === "image/svg+xml";
        }
        let originalWidth = img.width || img.naturalWidth;
        let originalHeight = img.height || img.naturalHeight;
        if (isSVG) {
          const svgMaxSize = 4096;
          const aspectRatio = originalWidth / originalHeight;
          if (originalWidth > originalHeight) {
            originalWidth = svgMaxSize;
            originalHeight = svgMaxSize / aspectRatio;
          } else {
            originalHeight = svgMaxSize;
            originalWidth = svgMaxSize * aspectRatio;
          }
          img.width = originalWidth;
          img.height = originalHeight;
        }
        const minDimension = Math.min(originalWidth, originalHeight);
        const targetSize = POISSON_CONFIG_OPTIMIZED.workingSize;
        const scaleFactor = targetSize / minDimension;
        const width = Math.round(originalWidth * scaleFactor);
        const height = Math.round(originalHeight * scaleFactor);
        if (POISSON_CONFIG_OPTIMIZED.measurePerformance) {
          console.log(\`[Processing Mode]\`);
          console.log(\`  Original: \${originalWidth}\\xD7\${originalHeight}\`);
          console.log(\`  Working: \${width}\\xD7\${height} (\${(scaleFactor * 100).toFixed(1)}% scale)\`);
          if (scaleFactor < 1) {
            console.log(\`  Speedup: ~\${Math.round(1 / (scaleFactor * scaleFactor))}\\xD7\`);
          }
        }
        canvas.width = originalWidth;
        canvas.height = originalHeight;
        const shapeCanvas = document.createElement("canvas");
        shapeCanvas.width = width;
        shapeCanvas.height = height;
        const shapeCtx = shapeCanvas.getContext("2d");
        shapeCtx.drawImage(img, 0, 0, width, height);
        const startMask = performance.now();
        const shapeImageData = shapeCtx.getImageData(0, 0, width, height);
        const data = shapeImageData.data;
        const shapeMask = new Uint8Array(width * height);
        const boundaryMask = new Uint8Array(width * height);
        let shapePixelCount = 0;
        for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
          const a = data[i + 3];
          const isShape = a === 0 ? 0 : 1;
          shapeMask[idx] = isShape;
          shapePixelCount += isShape;
        }
        const boundaryIndices = [];
        const interiorIndices = [];
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (!shapeMask[idx]) continue;
            let isBoundary = false;
            if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
              isBoundary = true;
            } else {
              isBoundary = !shapeMask[idx - 1] || // left
              !shapeMask[idx + 1] || // right
              !shapeMask[idx - width] || // top
              !shapeMask[idx + width] || // bottom
              !shapeMask[idx - width - 1] || // top-left
              !shapeMask[idx - width + 1] || // top-right
              !shapeMask[idx + width - 1] || // bottom-left
              !shapeMask[idx + width + 1];
            }
            if (isBoundary) {
              boundaryMask[idx] = 1;
              boundaryIndices.push(idx);
            } else {
              interiorIndices.push(idx);
            }
          }
        }
        if (POISSON_CONFIG_OPTIMIZED.measurePerformance) {
          console.log(\`[Mask Building] Time: \${(performance.now() - startMask).toFixed(2)}ms\`);
          console.log(
            \`  Shape pixels: \${shapePixelCount} / \${width * height} (\${(shapePixelCount / (width * height) * 100).toFixed(1)}%)\`
          );
          console.log(\`  Interior pixels: \${interiorIndices.length}\`);
          console.log(\`  Boundary pixels: \${boundaryIndices.length}\`);
        }
        const sparseData = buildSparseData(
          shapeMask,
          boundaryMask,
          new Uint32Array(interiorIndices),
          new Uint32Array(boundaryIndices),
          width,
          height
        );
        const startSolve = performance.now();
        const u = solvePoissonSparse(sparseData, shapeMask, boundaryMask, width, height);
        if (POISSON_CONFIG_OPTIMIZED.measurePerformance) {
          console.log(\`[Poisson Solve] Time: \${(performance.now() - startSolve).toFixed(2)}ms\`);
        }
        let maxVal = 0;
        let finalImageData;
        for (let i = 0; i < interiorIndices.length; i++) {
          const idx = interiorIndices[i];
          if (u[idx] > maxVal) maxVal = u[idx];
        }
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext("2d");
        const tempImg = tempCtx.createImageData(width, height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const px = idx * 4;
            if (!shapeMask[idx]) {
              tempImg.data[px] = 255;
              tempImg.data[px + 1] = 255;
              tempImg.data[px + 2] = 255;
              tempImg.data[px + 3] = 0;
            } else {
              const poissonRatio = u[idx] / maxVal;
              const gray = 255 * (1 - poissonRatio);
              tempImg.data[px] = gray;
              tempImg.data[px + 1] = gray;
              tempImg.data[px + 2] = gray;
              tempImg.data[px + 3] = 255;
            }
          }
        }
        tempCtx.putImageData(tempImg, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(tempCanvas, 0, 0, width, height, 0, 0, originalWidth, originalHeight);
        const outImg = ctx.getImageData(0, 0, originalWidth, originalHeight);
        const originalCanvas = document.createElement("canvas");
        originalCanvas.width = originalWidth;
        originalCanvas.height = originalHeight;
        const originalCtx = originalCanvas.getContext("2d");
        originalCtx.drawImage(img, 0, 0, originalWidth, originalHeight);
        const originalData = originalCtx.getImageData(0, 0, originalWidth, originalHeight);
        for (let i = 0; i < outImg.data.length; i += 4) {
          const a = originalData.data[i + 3];
          const upscaledAlpha = outImg.data[i + 3];
          if (a === 0) {
            outImg.data[i] = 255;
            outImg.data[i + 1] = 0;
          } else {
            outImg.data[i] = upscaledAlpha === 0 ? 0 : outImg.data[i];
            outImg.data[i + 1] = a;
          }
          outImg.data[i + 2] = 255;
          outImg.data[i + 3] = 255;
        }
        ctx.putImageData(outImg, 0, 0);
        finalImageData = outImg;
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Failed to create PNG blob"));
            return;
          }
          if (POISSON_CONFIG_OPTIMIZED.measurePerformance) {
            const totalTime = performance.now() - totalStartTime;
            console.log(\`[Total Processing Time] \${totalTime.toFixed(2)}ms\`);
            if (scaleFactor < 1) {
              const estimatedFullResTime = totalTime * Math.pow(originalWidth * originalHeight / (width * height), 1.5);
              console.log(\`[Estimated time at full resolution] ~\${estimatedFullResTime.toFixed(0)}ms\`);
              console.log(
                \`[Time saved] ~\${(estimatedFullResTime - totalTime).toFixed(0)}ms (\${Math.round(estimatedFullResTime / totalTime)}\\xD7 faster)\`
              );
            }
          }
          resolve({
            imageData: finalImageData,
            pngBlob: blob
          });
        }, "image/png");
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = typeof file === "string" ? file : URL.createObjectURL(file);
    });
  }
  function buildSparseData(shapeMask, boundaryMask, interiorPixels, boundaryPixels, width, height) {
    const pixelCount = interiorPixels.length;
    const neighborIndices = new Int32Array(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
      const idx = interiorPixels[i];
      const x = idx % width;
      const y = Math.floor(idx / width);
      neighborIndices[i * 4 + 0] = x < width - 1 && shapeMask[idx + 1] ? idx + 1 : -1;
      neighborIndices[i * 4 + 1] = x > 0 && shapeMask[idx - 1] ? idx - 1 : -1;
      neighborIndices[i * 4 + 2] = y > 0 && shapeMask[idx - width] ? idx - width : -1;
      neighborIndices[i * 4 + 3] = y < height - 1 && shapeMask[idx + width] ? idx + width : -1;
    }
    return {
      interiorPixels,
      boundaryPixels,
      pixelCount,
      neighborIndices
    };
  }
  function solvePoissonSparse(sparseData, shapeMask, boundaryMask, width, height) {
    const ITERATIONS = POISSON_CONFIG_OPTIMIZED.iterations;
    const C = 0.01;
    const u = new Float32Array(width * height);
    const { interiorPixels, neighborIndices, pixelCount } = sparseData;
    const startTime = performance.now();
    const omega = 1.9;
    const redPixels = [];
    const blackPixels = [];
    for (let i = 0; i < pixelCount; i++) {
      const idx = interiorPixels[i];
      const x = idx % width;
      const y = Math.floor(idx / width);
      if ((x + y) % 2 === 0) {
        redPixels.push(i);
      } else {
        blackPixels.push(i);
      }
    }
    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (const i of redPixels) {
        const idx = interiorPixels[i];
        const eastIdx = neighborIndices[i * 4 + 0];
        const westIdx = neighborIndices[i * 4 + 1];
        const northIdx = neighborIndices[i * 4 + 2];
        const southIdx = neighborIndices[i * 4 + 3];
        let sumN = 0;
        if (eastIdx >= 0) sumN += u[eastIdx];
        if (westIdx >= 0) sumN += u[westIdx];
        if (northIdx >= 0) sumN += u[northIdx];
        if (southIdx >= 0) sumN += u[southIdx];
        const newValue = (C + sumN) / 4;
        u[idx] = omega * newValue + (1 - omega) * u[idx];
      }
      for (const i of blackPixels) {
        const idx = interiorPixels[i];
        const eastIdx = neighborIndices[i * 4 + 0];
        const westIdx = neighborIndices[i * 4 + 1];
        const northIdx = neighborIndices[i * 4 + 2];
        const southIdx = neighborIndices[i * 4 + 3];
        let sumN = 0;
        if (eastIdx >= 0) sumN += u[eastIdx];
        if (westIdx >= 0) sumN += u[westIdx];
        if (northIdx >= 0) sumN += u[northIdx];
        if (southIdx >= 0) sumN += u[southIdx];
        const newValue = (C + sumN) / 4;
        u[idx] = omega * newValue + (1 - omega) * u[idx];
      }
    }
    if (POISSON_CONFIG_OPTIMIZED.measurePerformance) {
      const elapsed = performance.now() - startTime;
      console.log(\`[Optimized Poisson Solver (SOR \\u03C9=\${omega})]\`);
      console.log(\`  Working size: \${width}\\xD7\${height}\`);
      console.log(\`  Iterations: \${ITERATIONS}\`);
      console.log(\`  Time: \${elapsed.toFixed(2)}ms\`);
      console.log(\`  Interior pixels processed: \${pixelCount}\`);
      console.log(\`  Speed: \${(ITERATIONS * pixelCount / (elapsed * 1e3)).toFixed(2)} Mpixels/sec\`);
    }
    return u;
  }
  var LiquidMetalShapes = {
    none: 0,
    circle: 1,
    daisy: 2,
    diamond: 3,
    metaballs: 4
  };

  // ../paper-shaders/packages/shaders/src/vertex-shader.ts
  var vertexShaderSource = \`#version 300 es
precision mediump float;

layout(location = 0) in vec4 a_position;

uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform float u_imageAspectRatio;
uniform float u_originX;
uniform float u_originY;
uniform float u_worldWidth;
uniform float u_worldHeight;
uniform float u_fit;
uniform float u_scale;
uniform float u_rotation;
uniform float u_offsetX;
uniform float u_offsetY;

out vec2 v_objectUV;
out vec2 v_objectBoxSize;
out vec2 v_responsiveUV;
out vec2 v_responsiveBoxGivenSize;
out vec2 v_patternUV;
out vec2 v_patternBoxSize;
out vec2 v_imageUV;

vec3 getBoxSize(float boxRatio, vec2 givenBoxSize) {
  vec2 box = vec2(0.);
  // fit = none
  box.x = boxRatio * min(givenBoxSize.x / boxRatio, givenBoxSize.y);
  float noFitBoxWidth = box.x;
  if (u_fit == 1.) { // fit = contain
    box.x = boxRatio * min(u_resolution.x / boxRatio, u_resolution.y);
  } else if (u_fit == 2.) { // fit = cover
    box.x = boxRatio * max(u_resolution.x / boxRatio, u_resolution.y);
  }
  box.y = box.x / boxRatio;
  return vec3(box, noFitBoxWidth);
}

void main() {
  gl_Position = a_position;

  vec2 uv = gl_Position.xy * .5;
  vec2 boxOrigin = vec2(.5 - u_originX, u_originY - .5);
  vec2 givenBoxSize = vec2(u_worldWidth, u_worldHeight);
  givenBoxSize = max(givenBoxSize, vec2(1.)) * u_pixelRatio;
  float r = u_rotation * 3.14159265358979323846 / 180.;
  mat2 graphicRotation = mat2(cos(r), sin(r), -sin(r), cos(r));
  vec2 graphicOffset = vec2(-u_offsetX, u_offsetY);


  // ===================================================

  float fixedRatio = 1.;
  vec2 fixedRatioBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );

  v_objectBoxSize = getBoxSize(fixedRatio, fixedRatioBoxGivenSize).xy;
  vec2 objectWorldScale = u_resolution.xy / v_objectBoxSize;

  v_objectUV = uv;
  v_objectUV *= objectWorldScale;
  v_objectUV += boxOrigin * (objectWorldScale - 1.);
  v_objectUV += graphicOffset;
  v_objectUV /= u_scale;
  v_objectUV = graphicRotation * v_objectUV;

  // ===================================================

  v_responsiveBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );
  float responsiveRatio = v_responsiveBoxGivenSize.x / v_responsiveBoxGivenSize.y;
  vec2 responsiveBoxSize = getBoxSize(responsiveRatio, v_responsiveBoxGivenSize).xy;
  vec2 responsiveBoxScale = u_resolution.xy / responsiveBoxSize;

  #ifdef ADD_HELPERS
  v_responsiveHelperBox = uv;
  v_responsiveHelperBox *= responsiveBoxScale;
  v_responsiveHelperBox += boxOrigin * (responsiveBoxScale - 1.);
  #endif

  v_responsiveUV = uv;
  v_responsiveUV *= responsiveBoxScale;
  v_responsiveUV += boxOrigin * (responsiveBoxScale - 1.);
  v_responsiveUV += graphicOffset;
  v_responsiveUV /= u_scale;
  v_responsiveUV.x *= responsiveRatio;
  v_responsiveUV = graphicRotation * v_responsiveUV;
  v_responsiveUV.x /= responsiveRatio;

  // ===================================================

  float patternBoxRatio = givenBoxSize.x / givenBoxSize.y;
  vec2 patternBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );
  patternBoxRatio = patternBoxGivenSize.x / patternBoxGivenSize.y;

  vec3 boxSizeData = getBoxSize(patternBoxRatio, patternBoxGivenSize);
  v_patternBoxSize = boxSizeData.xy;
  float patternBoxNoFitBoxWidth = boxSizeData.z;
  vec2 patternBoxScale = u_resolution.xy / v_patternBoxSize;

  v_patternUV = uv;
  v_patternUV += graphicOffset / patternBoxScale;
  v_patternUV += boxOrigin;
  v_patternUV -= boxOrigin / patternBoxScale;
  v_patternUV *= u_resolution.xy;
  v_patternUV /= u_pixelRatio;
  if (u_fit > 0.) {
    v_patternUV *= (patternBoxNoFitBoxWidth / v_patternBoxSize.x);
  }
  v_patternUV /= u_scale;
  v_patternUV = graphicRotation * v_patternUV;
  v_patternUV += boxOrigin / patternBoxScale;
  v_patternUV -= boxOrigin;
  // x100 is a default multiplier between vertex and fragmant shaders
  // we use it to avoid UV presision issues
  v_patternUV *= .01;

  // ===================================================

  vec2 imageBoxSize;
  if (u_fit == 1.) { // contain
    imageBoxSize.x = min(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;
  } else if (u_fit == 2.) { // cover
    imageBoxSize.x = max(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;
  } else {
    imageBoxSize.x = min(10.0, 10.0 / u_imageAspectRatio * u_imageAspectRatio);
  }
  imageBoxSize.y = imageBoxSize.x / u_imageAspectRatio;
  vec2 imageBoxScale = u_resolution.xy / imageBoxSize;

  v_imageUV = uv;
  v_imageUV *= imageBoxScale;
  v_imageUV += boxOrigin * (imageBoxScale - 1.);
  v_imageUV += graphicOffset;
  v_imageUV /= u_scale;
  v_imageUV.x *= u_imageAspectRatio;
  v_imageUV = graphicRotation * v_imageUV;
  v_imageUV.x /= u_imageAspectRatio;

  v_imageUV += .5;
  v_imageUV.y = 1. - v_imageUV.y;
}\`;
  return __toCommonJS(liquid_metal_exports);
})();

// Compact WebGL2 mount for Paper-derived shaders.
// Mirrors the essentials of @paper-design/shaders ShaderMount:
// fullscreen quad, u_time/u_resolution/u_pixelRatio, float/bool/vec/vec4[] uniforms,
// image textures with \`\${name}AspectRatio\`, DPR-capped sizing, speed-gated rAF.

function __psParseColor(input) {
  var s = String(input || '').trim();
  var m = s.match(/^#?([0-9a-f]{3,8})$/i);
  if (m) {
    var h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(function (c) { return c + c; }).join('');
    if (h.length === 6) {
      var n6 = parseInt(h, 16);
      return [((n6 >> 16) & 255) / 255, ((n6 >> 8) & 255) / 255, (n6 & 255) / 255, 1];
    }
    if (h.length === 8) {
      var n8 = parseInt(h, 16);
      return [((n8 >>> 24) & 255) / 255, ((n8 >> 16) & 255) / 255, ((n8 >> 8) & 255) / 255, (n8 & 255) / 255];
    }
  }
  var rgb = s.match(/rgba?\\(([^)]+)\\)/i);
  if (rgb) {
    var p = rgb[1].split(',').map(parseFloat);
    return [(p[0] || 0) / 255, (p[1] || 0) / 255, (p[2] || 0) / 255, p.length > 3 ? p[3] : 1];
  }
  return [0, 0, 0, 1];
}

function __psLoadImage(url) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error('image failed: ' + url)); };
    img.src = url;
  });
}

function __psCreateMount(canvas, fragmentShader, vertexShader) {
  var gl = canvas.getContext('webgl2');
  if (!gl) return null;

  // Some mobile GPUs run mediump at <23 bits, which breaks these shaders — force highp there.
  var fmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT);
  if (fmt && fmt.precision < 23) {
    vertexShader = vertexShader.replace(/precision\\s+(lowp|mediump)\\s+float;/g, 'precision highp float;');
    fragmentShader = fragmentShader
      .replace(/precision\\s+(lowp|mediump)\\s+float/g, 'precision highp float')
      .replace(/\\b(uniform|varying|attribute)\\s+(lowp|mediump)\\s+(\\w+)/g, '$1 highp $3');
  }

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('Shader compile failed:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  var vs = compile(gl.VERTEX_SHADER, vertexShader);
  var fs = compile(gl.FRAGMENT_SHADER, fragmentShader);
  if (!vs || !fs) return null;
  var program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Shader link failed:', gl.getProgramInfoLog(program));
    return null;
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  gl.useProgram(program);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  var locs = {};
  function loc(name) {
    if (!(name in locs)) locs[name] = gl.getUniformLocation(program, name);
    return locs[name];
  }

  var textures = {};
  var units = {};
  var frameMs = 0;
  var speed = 0;
  var raf = 0;
  var last = 0;
  var disposed = false;
  var MAX_PX = 1920 * 1080 * 4;

  function render() {
    if (disposed) return;
    gl.useProgram(program);
    var lt = loc('u_time');
    if (lt) gl.uniform1f(lt, frameMs * 0.001);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function fit() {
    if (disposed) return;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var tw = Math.round(w * dpr), th = Math.round(h * dpr);
    var cap = Math.min(1, Math.sqrt(MAX_PX) / Math.sqrt(tw * th));
    tw = Math.max(1, Math.round(tw * cap));
    th = Math.max(1, Math.round(th * cap));
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
      gl.viewport(0, 0, tw, th);
      gl.useProgram(program);
      var lr = loc('u_resolution');
      if (lr) gl.uniform2f(lr, tw, th);
      var lp = loc('u_pixelRatio');
      if (lp) gl.uniform1f(lp, tw / w);
      render();
    }
  }
  var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  if (ro) ro.observe(canvas);
  fit();

  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (document.hidden) { last = now; return; }
    var dt = last ? now - last : 0;
    last = now;
    frameMs += dt * speed;
    render();
  }

  function bindTexture(name, upload, aspect, mip) {
    gl.useProgram(program);
    if (!(name in units)) units[name] = Object.keys(units).length;
    var unit = units[name];
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (textures[name]) gl.deleteTexture(textures[name]);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    upload();
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
    textures[name] = tex;
    var l = loc(name);
    if (l) gl.uniform1i(l, unit);
    var la = loc(name + 'AspectRatio');
    if (la) gl.uniform1f(la, aspect);
    render();
  }

  return {
    parseColor: __psParseColor,
    setUniforms: function (map) {
      if (disposed) return;
      gl.useProgram(program);
      for (var k in map) {
        var v = map[k];
        var l = loc(k);
        if (!l || v === undefined || v === null) continue;
        if (typeof v === 'number') gl.uniform1f(l, v);
        else if (typeof v === 'boolean') gl.uniform1i(l, v ? 1 : 0);
        else if (Array.isArray(v)) {
          if (Array.isArray(v[0])) {
            var flat = [];
            for (var i = 0; i < v.length; i++) for (var j = 0; j < v[i].length; j++) flat.push(v[i][j]);
            gl.uniform4fv(l, flat);
          } else if (v.length === 2) gl.uniform2fv(l, v);
          else if (v.length === 3) gl.uniform3fv(l, v);
          else if (v.length === 4) gl.uniform4fv(l, v);
        }
      }
      render();
    },
    setTexture: function (name, image, mip) {
      if (disposed) return;
      var aspect = (image.naturalWidth || image.width || 1) / (image.naturalHeight || image.height || 1);
      bindTexture(name, function () {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      }, aspect, mip);
    },
    setEmptyTexture: function (name) {
      if (disposed) return;
      bindTexture(name, function () {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      }, 1, false);
    },
    setSpeed: function (s) {
      if (disposed) return;
      speed = s || 0;
      if (speed !== 0 && !raf) { last = 0; raf = requestAnimationFrame(tick); }
      if (speed === 0 && raf) { cancelAnimationFrame(raf); raf = 0; render(); }
    },
    setFrameMs: function (ms) { frameMs = ms; render(); },
    resize: fit,
    dispose: function () {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      for (var k in textures) gl.deleteTexture(textures[k]);
      gl.deleteProgram(program);
      var ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  };
}
// ─── End vendored engine ───

function LiquidMetal({
  image = '', shape = 'diamond', colorBack = '#AAAAAC', colorTint = '#ffffff', distortion = 0.07, repetition = 2, shiftRed = 0.3, shiftBlue = 0.3, contour = 0.4, softness = 0.1, angle = 70, scale = 0.6, speed = 1,
  ...props
}) {
  const canvasRef = useRef(null);
  const isStatic = useStaticCanvas();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mount = __psCreateMount(canvas, __PAPER.fragmentShader, __PAPER.vertexShaderSource);
    if (!mount) return;
    let disposed = false;

    mount.setUniforms(Object.assign({ u_fit: 1, u_rotation: 0, u_offsetX: 0, u_offsetY: 0, u_originX: 0.5, u_originY: 0.5, u_worldWidth: 0, u_worldHeight: 0 }, {
      u_scale: scale,
      u_colorBack: mount.parseColor(colorBack), u_colorTint: mount.parseColor(colorTint),
      u_distortion: distortion, u_repetition: repetition,
      u_shiftRed: shiftRed, u_shiftBlue: shiftBlue,
      u_contour: contour, u_softness: softness, u_angle: angle,
      u_shape: __PAPER.shapes[shape] || 3,
      u_isImage: false
    }));
    mount.setEmptyTexture('u_image');
    if (image) {
      __PAPER.processImage(image).then((result) => {
        if (disposed) return;
        const url = URL.createObjectURL(result.pngBlob);
        return __psLoadImage(url).then((img) => {
          URL.revokeObjectURL(url);
          if (disposed) return;
          mount.setTexture('u_image', img, true);
          mount.setUniforms({ u_isImage: true });
        });
      }).catch(() => {});
    }
    mount.resize();
    if (isStatic) {
      mount.setFrameMs(2500);
    } else {
      mount.setSpeed(speed);
    }
    return () => { disposed = true; mount.dispose(); };
  }, [image, shape, colorBack, colorTint, distortion, repetition, shiftRed, shiftBlue, contour, softness, angle, scale, speed, isStatic]);

  return (
    <div {...props} style={{ position: 'relative', overflow: 'hidden', ...props.style }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

export default withResponsiveProps(LiquidMetal);
`;
