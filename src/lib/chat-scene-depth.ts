/** Image-projected geometry, not a flat plane translated with CSS. Depth is near-white/far-black. */
export interface ChatSceneMesh {
  vertices: Float32Array;
  indices: Uint16Array;
  columns: number;
  rows: number;
  minDepth: number;
  maxDepth: number;
  aspect: number;
}

export const CHAT_SCENE_DEPTH_LIMITS = Object.freeze({
  columns: 64, rows: 112, dpr: 1.25, width: 640, height: 1100, fps: 24,
  overscan: 1.065, cameraDistance: 2.8, depthRange: .66, fieldOfView: 45,
});

/** Bilinear grayscale sampling prevents low-resolution depth-map stair steps. */
export function sampleChatSceneDepth(depth: ImageData, u: number, v: number): number {
  const x = Math.max(0, Math.min(depth.width - 1, u * (depth.width - 1)));
  const y = Math.max(0, Math.min(depth.height - 1, v * (depth.height - 1)));
  const left = Math.floor(x), top = Math.floor(y), right = Math.min(left + 1, depth.width - 1), bottom = Math.min(top + 1, depth.height - 1);
  const gray = (px: number, py: number) => {
    const at = (py * depth.width + px) * 4;
    return (depth.data[at] * .2126 + depth.data[at + 1] * .7152 + depth.data[at + 2] * .0722) / 255;
  };
  const a = gray(left, top) * (1 - x + left) + gray(right, top) * (x - left);
  const b = gray(left, bottom) * (1 - x + left) + gray(right, bottom) * (x - left);
  return a * (1 - y + top) + b * (y - top);
}

/** The resting camera reconstructs object-fit:cover, even though each vertex has a different z. */
export function createChatSceneMesh(width: number, height: number, imageAspect: number, depth: ImageData): ChatSceneMesh {
  const { columns, rows, overscan, cameraDistance, depthRange, fieldOfView } = CHAT_SCENE_DEPTH_LIMITS;
  const aspect = Math.max(.1, width / Math.max(1, height));
  const tangent = Math.tan(fieldOfView * Math.PI / 360);
  const coverX = imageAspect > aspect ? aspect / imageAspect : 1;
  const coverY = imageAspect < aspect ? imageAspect / aspect : 1;
  const vertices = new Float32Array((columns + 1) * (rows + 1) * 5);
  const indices = new Uint16Array(columns * rows * 6);
  let minDepth = 1, maxDepth = 0, offset = 0;
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const sx = column / columns, sy = row / rows;
    const u = .5 + (sx - .5) * coverX, v = .5 + (sy - .5) * coverY;
    const distance = sampleChatSceneDepth(depth, u, v);
    minDepth = Math.min(minDepth, distance); maxDepth = Math.max(maxDepth, distance);
    const z = cameraDistance - distance * depthRange;
    vertices.set([(sx * 2 - 1) * tangent * aspect * z * overscan, (1 - sy * 2) * tangent * z * overscan, -z, u, v], offset);
    offset += 5;
  }
  offset = 0;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * (columns + 1) + column, b = a + columns + 1;
    indices.set([a, b, a + 1, a + 1, b, b + 1], offset); offset += 6;
  }
  return { vertices, indices, columns, rows, minDepth, maxDepth, aspect };
}

export function chatSceneBufferSize(width: number, height: number, devicePixelRatio: number) {
  const budget = CHAT_SCENE_DEPTH_LIMITS;
  const scale = Math.min(Math.max(1, devicePixelRatio), budget.dpr, budget.width / Math.max(1, width), budget.height / Math.max(1, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

export const CHAT_SCENE_VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec2 aUv;
uniform vec2 uCamera;
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec3 p = aPosition - vec3(uCamera, 0.0);
  // Look toward the middle depth plane. Nearby geometry moves farther than the distant room.
  float yaw = -uCamera.x / 2.5, pitch = uCamera.y / 2.5;
  p.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xz;
  p.yz = mat2(cos(pitch), -sin(pitch), sin(pitch), cos(pitch)) * p.yz;
  float tangent = 0.41421356237;
  gl_Position = vec4(p.x / (tangent * uAspect), p.y / tangent, -1.02020202 * p.z - .202020202, -p.z);
  vUv = aUv;
}`;

export const CHAT_SCENE_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uImage;
uniform float uTime;
uniform float uKind;
uniform float uStrength;
uniform float uDust;
uniform float uDark;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float spot(vec2 p, vec2 c, vec2 r) { vec2 q = (p-c)/r; return exp(-dot(q,q)*2.0); }
void main() {
  vec2 uv = vUv;
  vec3 color = texture2D(uImage, uv).rgb;
  float t = uTime;
  vec3 light = vec3(0.0);
  if (uKind < .5) {
    // Two slow steam ribbons above the foreground table; no blur on the photograph.
    float height = clamp((.86-uv.y)/.29, 0.0, 1.0);
    float x = .29 + sin(height*8.0-t*.65)*(.008+height*.017);
    float steam = exp(-pow((uv.x-x)/(.005+height*.006),2.0));
    steam += exp(-pow((uv.x-x-.032-sin(height*6.0+t*.4)*.008)/.007,2.0))*.6;
    steam *= smoothstep(.86,.79,uv.y)*smoothstep(.54,.65,uv.y)*(0.6+sin(height*10.0-t*.6)*.25);
    light += vec3(.92,.88,.78)*steam*.055;
    light += vec3(1.0,.62,.28)*spot(uv,vec2(.75,.16),vec2(.24,.23))*(.018+sin(t*.48)*.009);
  } else if (uKind < 1.5) {
    vec2 rainUv = vec2(uv.x*39.0, uv.y*3.8);
    float seed = hash(vec2(floor(rainUv.x), 3.0));
    float tail = fract(rainUv.y-t*(.12+seed*.09)+seed*9.0);
    float rain = exp(-pow((fract(rainUv.x)-.5)/.025,2.0))*smoothstep(.34,.0,tail);
    rain *= smoothstep(.36,.59,uv.x)*smoothstep(.77,.61,uv.y);
    light += vec3(.64,.78,.94)*rain*.13;
    light += vec3(.42,.59,.8)*spot(uv,vec2(.8,.22),vec2(.3,.3))*sin(t*.22)*.012;
  } else if (uKind < 2.5) {
    float wave = abs(sin(uv.x*43.0+sin(uv.y*24.0+t*.33)*1.5+t*.22));
    float caustic = pow(max(0.0,1.0-wave),14.0)*smoothstep(.48,.82,uv.y);
    light += vec3(.65,.88,.94)*caustic*.035;
    light += vec3(.96,.86,.62)*spot(uv,vec2(.19,.28),vec2(.48,.4))*(sin(t*.3)*.006);
  } else if (uKind < 3.5) {
    float ray = pow(max(0.0,sin((uv.x-uv.y*.39)*26.0+sin(t*.2)*.14)),14.0);
    ray *= smoothstep(.9,.12,uv.y)*smoothstep(.84,.22,uv.x);
    light += vec3(.9,.94,.69)*ray*.023;
  } else if (uKind < 4.5) {
    light += vec3(1.0,.66,.34)*spot(uv,vec2(.2,.21),vec2(.48,.5))*(.012+sin(t*.38)*.006);
  } else {
    // Sparse garden lights, never a screen-wide particle shower.
    for (int i=0; i<6; i++) {
      float f=float(i), s=hash(vec2(f,8.0));
      vec2 p=vec2(.1+s*.8, .27+hash(vec2(f,9.0))*.54);
      p += vec2(sin(t*.19+f),cos(t*.16+f*2.0))*.009;
      light += vec3(.85,1.0,.49)*spot(uv,p,vec2(.006,.004))*(.1+sin(t*.9+f)*.07);
    }
  }
  if (uKind > 2.5 && uKind < 4.5 || uDust > .5) {
    for (int i=0; i<9; i++) {
      float f=float(i), s=hash(vec2(f,4.0));
      vec2 p=vec2(.08+s*.84,fract(hash(vec2(f,5.0))-t*(.002+s*.001)));
      p.x += sin(t*.13+f*2.0)*.009;
      light += vec3(.98,.88,.65)*spot(uv,p,vec2(.0028,.0018))*.08;
    }
  }
  color += light * uStrength * mix(.8,1.0,uDark);
  gl_FragColor = vec4(clamp(color,0.0,1.0),1.0);
}`;
