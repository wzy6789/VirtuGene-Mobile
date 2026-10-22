/** Native WebGL decoration: analytic intersections, not a flat poster or a raymarch. */
export const STARFIELD_DEPTH_DPR = 1.5;
export const STARFIELD_DEPTH_FRAME_MS = 1000 / 30;

const vertexSource = `
attribute vec2 aPosition;
varying vec2 vUv;
void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}
`;

const fragmentSource = `
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform vec2 uLook;
uniform float uTime;
uniform float uLight;
uniform float uHasTexture;
uniform sampler2D uSurface;
const float PI=3.14159265359;

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){float n=0.,a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=mat2(1.61,1.17,-1.17,1.61)*p+3.1;a*=.5;}return n;}
mat2 turn(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
vec2 surfaceUv(vec3 n){n.xz=turn(.18+uTime*.012+uLook.x*.045)*n.xz;n.xy=turn(-.22+uLook.y*.035)*n.xy;return vec2(atan(n.z,n.x)/(2.*PI)+.5,asin(clamp(n.y,-1.,1.))/PI+.5);}

// Nine bounded cells provide broad crater bowls and raised rims, with no marching loop.
float rockHeight(vec2 uv){
  vec2 p=uv*19.,cell=floor(p),f=fract(p);float cr=0.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 o=vec2(float(x),float(y)),id=cell+o;
    vec2 c=o+vec2(hash(id),hash(id+29.));
    float radius=.17+.2*hash(id+67.),d=length(f-c)/radius;
    cr+=-.17*(1.-smoothstep(.12,.94,d))+.09*exp(-pow((d-1.04)*9.,2.));
  }
  return fbm(uv*67.)*.2+noise(uv*190.)*.025+cr;
}
float surfaceHeight(vec2 uv){
  if(uHasTexture>.5){vec3 t=texture2D(uSurface,uv).rgb;return dot(t,vec3(.299,.587,.114))*.34+noise(uv*240.)*.008;}
  return rockHeight(uv);
}
float hitSphere(vec3 ro,vec3 rd,vec3 center,float r){vec3 oc=ro-center;float b=dot(oc,rd),h=b*b-dot(oc,oc)+r*r;return h<0.?1000.:-b-sqrt(h);}
vec3 mineral(vec3 n,vec3 ray){
  vec2 uv=surfaceUv(n);float h=surfaceHeight(uv),e=.0015;
  float hx=surfaceHeight(uv+vec2(e,0.))-surfaceHeight(uv-vec2(e,0.));
  float hy=surfaceHeight(uv+vec2(0.,e))-surfaceHeight(uv-vec2(0.,e));
  vec3 tangent=normalize(vec3(-n.z,0.,n.x));vec3 bitangent=normalize(cross(n,tangent));
  vec3 bn=normalize(n-tangent*hx*8.-bitangent*hy*8.);
  vec3 light=normalize(vec3(-.65,.72,1.2));float diffuse=max(0.,dot(bn,light));
  vec3 albedo=mix(vec3(.16,.205,.25),vec3(.47,.51,.55),clamp(h*2.8+.35,0.,1.));
  if(uHasTexture>.5)albedo=texture2D(uSurface,uv).rgb;
  // Rough mineral response: broad reflected light, tiny specular, and a cool limb.
  float spec=pow(max(0.,dot(reflect(-light,bn),-ray)),24.)*.08;
  float rim=pow(1.-max(0.,dot(n,-ray)),3.8);
  return albedo*(.17+.94*diffuse)+spec+vec3(.39,.57,.72)*rim*.38;
}
vec3 starLayer(vec2 p,float scale,float amount){
  vec2 cell=floor(p*scale),f=fract(p*scale),point=vec2(hash(cell),hash(cell+9.));
  float seed=hash(cell+71.),d=length((f-point)*vec2(1.,1.));
  float star=(1.-smoothstep(.006,.032,d))*step(amount,seed);
  float halo=exp(-d*d*650.)*.10*step(.988,seed);
  return vec3(.53,.66,.78)*(star+halo);
}
void main(){
  float aspect=uResolution.x/uResolution.y;
  vec2 p=(vUv-.5)*vec2(aspect,1.);
  vec3 ro=vec3(p,3.),rd=vec3(0.,0.,-1.);
  vec3 center=vec3(aspect*.20+uLook.x*.009,-.025+uLook.y*.006,0.);
  float radius=.47,tSphere=hitSphere(ro,rd,center,radius);
  vec3 dark=mix(vec3(.023,.035,.05),vec3(.055,.078,.10),vUv.y);
  vec3 color=mix(dark,vec3(.91,.928,.93),uLight);
  float haze=exp(-length((p-center.xy)*vec2(.8,1.))*2.8);
  color+=mix(vec3(.026,.046,.065),vec3(.013,.018,.019),uLight)*haze;
  color+=starLayer(p+uLook*.002,20.,.947)*(1.-uLight*.72);
  color+=starLayer(p+uLook*.004,8.,.987)*(1.-uLight*.65);
  float edge=length(p-center.xy)-radius;
  float atmosphere=exp(-max(0.,edge)*90.)*smoothstep(-.012,.009,edge);
  color+=vec3(.35,.53,.68)*atmosphere*.23;
  if(tSphere<100.){vec3 normal=normalize(ro+rd*tSphere-center);color=mineral(normal,rd);}

  // Plane intersection gives a real depth test: its back arc disappears behind the sphere.
  vec3 ringNormal=normalize(vec3(-.15,.77,.62));
  float tRing=dot(center-ro,ringNormal)/dot(rd,ringNormal);
  vec3 ringPoint=ro+rd*tRing-center;
  float ringRadius=.72,aa=1.15/uResolution.y;
  float line=1.-smoothstep(.0015,.0015+aa,abs(length(ringPoint)-ringRadius));
  float distantLine=(1.-smoothstep(.00045,.00045+aa,abs(length(ringPoint)-ringRadius-.034)))*.15;
  if(tRing>0.&&tRing<tSphere){float lit=.52+.30*dot(normalize(ringPoint),normalize(vec3(-1,1,1)));color=mix(color,mix(vec3(.50,.69,.80),vec3(.31,.48,.58),uLight),clamp((line+distantLine)*lit,0.,1.));}
  vec3 axis=normalize(cross(ringNormal,vec3(0.,0.,1.))),other=cross(ringNormal,axis);
  float phase=3.7+uTime*.065;vec3 moon=center+ringRadius*(cos(phase)*axis+sin(phase)*other);
  float tm=hitSphere(ro,rd,moon,.021);
  if(tm<tSphere&&tm<100.){vec3 n=normalize(ro+rd*tm-moon);float l=max(0.,dot(n,normalize(vec3(-.6,.8,1.))));color=vec3(.42,.59,.68)*(.35+.8*l)+pow(max(0.,n.z),20.)*.35;}
  float vignette=smoothstep(.3,1.,length((vUv-.5)*vec2(1.,.8)));
  color*=1.-vignette*.14;
  gl_FragColor=vec4(clamp(color,0.,1.),1.);
}`;

export interface StarfieldDepthRenderer {
  resize(): void;
  draw(time: number, lookX: number, lookY: number, light: boolean): boolean;
  dispose(): void;
}

export function createStarfieldDepthRenderer(
  canvas: HTMLCanvasElement,
  options: { textureUrl?: string; onTextureReady?: () => void },
): StarfieldDepthRenderer {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL unavailable');
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null, texture: WebGLTexture | null = null;
  const release = () => {
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
  };
  try {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Shader allocation failed');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed');
      return shader;
    };
    program = gl.createProgram();
    if (!program) throw new Error('Program allocation failed');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed');
    gl.useProgram(program);
    buffer = gl.createBuffer(); texture = gl.createTexture();
    if (!buffer || !texture) throw new Error('WebGL resource allocation failed');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([90, 105, 120, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const uniform = (name: string) => gl.getUniformLocation(program!, name);
    const resolution = uniform('uResolution'), time = uniform('uTime'), look = uniform('uLook'), light = uniform('uLight'), hasTexture = uniform('uHasTexture');
    gl.uniform1i(uniform('uSurface'), 0);
    let disposed = false, readyTexture = false;
    const resize = () => {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, STARFIELD_DEPTH_DPR);
      const width = Math.max(1, Math.min(900, Math.round(rect.width * dpr))), height = Math.max(1, Math.min(600, Math.round(rect.height * dpr)));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
    };
    resize();
    const image = options.textureUrl ? new Image() : null;
    if (image) {
      image.decoding = 'async';
      image.onload = () => {
        if (disposed || gl.isContextLost()) return;
        try {
          gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          const powerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;
          if (powerOfTwo(image.naturalWidth) && powerOfTwo(image.naturalHeight)) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          }
          readyTexture = true; options.onTextureReady?.();
        } catch { /* A failed/tainted map retains the procedural mineral surface. */ }
      };
      image.src = options.textureUrl!;
    }
    return {
      resize,
      draw(seconds, x, y, isLight) {
        if (disposed || gl.isContextLost()) return false;
        gl.useProgram(program);
        gl.uniform2f(resolution, canvas.width, canvas.height); gl.uniform1f(time, seconds); gl.uniform2f(look, x, y); gl.uniform1f(light, isLight ? 1 : 0); gl.uniform1f(hasTexture, readyTexture ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return true;
      },
      dispose() { disposed = true; if (image) { image.onload = null; image.onerror = null; image.removeAttribute('src'); } release(); },
    };
  } catch (error) { release(); throw error; }
}
