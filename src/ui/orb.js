/**
 * C4emem 语音光球 —— 纯 WebGL，零依赖（App 离线也能跑）。
 *
 * 做法：**光线步进一个被噪声扰动的球**，不是贴图、不是模型文件。
 * 为什么不用 three.js：要为一张球引一个 600KB 的库 + 一个打包步骤，
 * 而这里需要的只是一段片元着色器。
 *
 * 三种形态（用户可切换）：
 *   pearl —— 珍珠/液态玻璃（参考 dribbble 15520653）：半透明、高光、
 *            内部流动褶皱、边缘彩虹（薄膜干涉）
 *   stone —— 岩石（参考 dribbble 23020059）：暖米色、偏哑光、纹理更粗
 *   lime  —— 柠檬绿发光盘（参考 Deepgram）：近白底、自发光的芯
 *
 * 三种状态：
 *   idle      匀速慢速呼吸 + 缓慢流动
 *   listening 跟着**麦克风音量**动：越大 → 形变越快、越亮、边缘越锐
 *   thinking  规则地脉动（不是靠音量，是"在处理"的节奏）
 */

const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uLevel;     // 0..1 实时音量
uniform float uState;     // 0 = idle, 1 = listening, 2 = thinking
uniform float uVariant;   // 0 = pearl, 1 = stone, 2 = lime
uniform float uStage;     // 1 = 暗舞台（全屏铺底时用），0 = 原来的浅底

// ── 噪声（值噪声 + fbm）─────────────────────────────────────
float hash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.02; a *= 0.5; }
  return s;
}

// 形变的"速度"由状态决定 —— 用户要的"输入时跟着语速/语调动"就落在这里
float flowSpeed(){
  if (uState > 1.5) return 0.55 + 0.35 * sin(uTime * 2.2);       // thinking：规则脉动
  if (uState > 0.5) return 0.35 + uLevel * 2.2;                  // listening：跟着音量
  return 0.22;                                                   // idle：恒定
}

float map(vec3 p){
  float sp = flowSpeed();
  vec3 q = p;
  float t = uTime * sp;

  // 域扭曲：先让噪声被另一层噪声推歪 —— 这是"液态"感的关键，
  // 直接叠 fbm 只会得到粗糙的疙瘩。
  vec3 w = vec3(fbm(q * 0.9 + vec3(0.0, 0.0, t * 0.7)),
                fbm(q * 0.9 + vec3(5.2, 1.3, t * 0.6)),
                fbm(q * 0.9 + vec3(9.7, 2.8, t * 0.5)));
  float d  = fbm(q * 1.45 + w * 0.85 + vec3(0.0, 0.0, t));
  float d2 = fbm(q * 3.30 - w * 0.40 - vec3(t * 0.5, 0.0, 0.0));

  float amp = 0.20 + 0.16 * uLevel * (uState > 0.5 ? 1.0 : 0.0);
  float disp = (d - 0.5) * amp + (d2 - 0.5) * amp * 0.16;

  float R = 1.0;
  if (uVariant > 1.5) R = 0.92;        // lime 略小
  return length(p) - (R + disp);
}

vec3 normalAt(vec3 p){
  vec2 e = vec2(0.0022, 0.0);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy),
                        map(p + e.yxy) - map(p - e.yxy),
                        map(p + e.yyx) - map(p - e.yyx)));
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  uv *= 2.15;

  vec3 ro = vec3(0.0, 0.0, -3.35);
  vec3 rd = normalize(vec3(uv, 1.55));

  float t = 0.0;
  float hit = 0.0;
  for (int i = 0; i < 96; i++){
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.0015){ hit = 1.0; break; }
    if (t > 6.0) break;
    t += d * 0.82;
  }

  vec3 bg;
  if (uVariant > 1.5)      bg = vec3(0.968, 0.972, 0.958);   // lime：近白（Deepgram 那种）
  else if (uVariant > 0.5) bg = vec3(0.905, 0.873, 0.820);   // stone：暖米
  else                     bg = vec3(0.930, 0.933, 0.938);   // pearl：浅灰

  // ⚠️⚠️ 全屏铺底时这块底色**必须变暗**，否则整屏是一片死灰：
  //     玻璃面板浮在同亮度的一层灰上 = 看不出是玻璃；珍珠球压浅底 = 对比度 3% 看不见。
  //     （实测：底色 207、球面 199 —— 差的 8/255 就是"洗白"的真身。）
  //     数值是**反推**的：着色器末尾 col=1-exp(-k) 再开 0.4545 次方，
  //     想落到 sRGB≈0.12 就得让线性值在 0.008 上下，凭感觉填会明显偏亮。
  if (uStage > 0.5) {
    float g = clamp(uv.y * 0.5 + 0.5, 0.0, 1.0);            // 上略亮、下沉下去
    bg = mix(vec3(0.006, 0.007, 0.011), vec3(0.030, 0.034, 0.047), g);
    bg += vec3(0.030, 0.042, 0.080) * exp(-dot(uv - vec2(-1.15, 0.95), uv - vec2(-1.15, 0.95)) * 1.15);
    bg += vec3(0.028, 0.038, 0.014) * exp(-dot(uv - vec2(1.15, -0.95), uv - vec2(1.15, -0.95)) * 1.30);
  }

  // 背景也加一点极淡的暗角，避免"贴在纸上"的扁平感
  vec3 col = bg * (1.0 - 0.05 * dot(uv, uv));

  if (hit > 0.5){
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p);
    vec3 v = -rd;
    float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.2);

    // 主光 + 补光（都在摄像机侧，做成柔和的产品光）
    vec3 l1 = normalize(vec3(-0.55, 0.75, -0.75));
    vec3 l2 = normalize(vec3(0.70, -0.25, -0.55));
    float dif = clamp(dot(n, l1), 0.0, 1.0);
    float dif2 = clamp(dot(n, l2), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-l1, n), v), 0.0, 1.0), 62.0);
    float spec2 = pow(clamp(dot(reflect(-l2, n), v), 0.0, 1.0), 26.0);

    // 薄膜干涉 / 彩虹边：视线与法线夹角 + 噪声扰动 → 色相
    float ang = dot(n, v);
    float hueShift = ang * 3.0 + fbm(p * 1.7 + uTime * 0.05) * 1.6 + uLevel * 0.6;
    vec3 irid = 0.5 + 0.5 * cos(6.28318 * (hueShift + vec3(0.00, 0.33, 0.67)));

    vec3 base, specCol;
    float iridAmt, amb;
    if (uVariant > 1.5){
      base   = vec3(0.86, 0.94, 0.20);       // 柠檬绿
      specCol= vec3(1.0);
      iridAmt= 0.12; amb = 0.55;
    } else if (uVariant > 0.5){
      base   = vec3(0.84, 0.78, 0.68);       // 岩石
      specCol= vec3(1.0, 0.98, 0.94);
      iridAmt= 0.05; amb = 0.34;
    } else {
      base   = vec3(0.97, 0.97, 0.99);       // 珍珠
      specCol= vec3(1.0);
      iridAmt= 0.50; amb = 0.30;
    }

    col  = base * (amb + dif * 1.05 + dif2 * 0.30);
    // 轮廓光：把球从同样浅的背景里"切"出来（否则白球压白底 = 看不见）
    col += vec3(1.0) * fres * 0.10;
    col += specCol * spec * (uVariant > 0.5 ? 0.40 : 0.90);
    col += specCol * spec2 * 0.30;
    // 掠射角的宽柔光 + 收边高光：玻璃感主要来自这两笔
    col += vec3(1.0) * pow(fres, 1.3) * 0.10;
    col += vec3(1.0) * pow(fres, 6.0) * 0.30;
    col += irid * fres * iridAmt;

    // 边缘自发光的"能量环"：listening/thinking 时更明显
    float glow = uState > 0.5 ? (0.10 + 0.28 * uLevel) : 0.06;
    col += vec3(0.95, 1.0, 0.55) * fres * glow * (uVariant > 1.5 ? 1.7 : 0.55);

    // 内部能看到流动的结构（半透明的关键：把背面的形变透一点上来）
    // 内部透出来的流动结构 —— 用**大尺度**噪声，且只轻微提亮。
    // 上一版用 fbm(p*2.1) 逐点取样，等于往表面撒了一层噪点（参考里表面是光滑的）。
    float inner = fbm(p * 0.75 - vec3(0.0, 0.0, uTime * flowSpeed() * 0.7));
    col = mix(col, col * 1.14 + 0.03, smoothstep(0.52, 0.92, inner) * (uVariant < 0.5 ? 0.30 : 0.12));

    // ⚠️ 这里原本有一行「轮廓收边」：
    //      col = mix(bg, col, smoothstep(0.985, 0.999, clamp(t*0.30,0,1)));
    //    命中距离 t≈2.4 ⇒ t*0.30=0.72 ⇒ smoothstep()=0 ⇒ **整颗球被涂成了背景色**，
    //    看起来就是"渲染没出来"。而且它还是静默的：背景和球都画了，只是最后被抹平。
    //    光线步进出来的轮廓本身是干净的，这一行纯属多余 —— 删掉。
  }

  // ⚠️ 色调映射必须在 gamma 之前。
  //    少了这一步，一切 >1 的像素被直接削平 ⇒ 高光和球体糊成同一片纯白（实测过）。
  col = 1.0 - exp(-col * 1.15);
  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));   // 线性 → sRGB
  gl_FragColor = vec4(col, 1.0);
}
`;

export const VARIANTS = ['pearl', 'stone', 'lime'];
// ⚠️ `珍珠玻璃` → `珍珠`（读者 2026-10-10：「珍珠玻璃改为珍珠」）。
//    这三个只剩 `pearl` 还在下拉里，另外两个（岩石/柠檬绿盘）是着色器那一路的备胎。
export const VARIANTS_CN = { pearl: '珍珠', stone: '岩石', lime: '柠檬绿盘' };

export function createOrb(canvas, opts = {}) {
  // stage: 全屏铺底（暗舞台）—— 语音那一屏用；orb-demo 那种镶在页面里的仍用浅底
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('这个环境不支持 WebGL');

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('着色器编译失败：' + gl.getShaderInfoLog(s));
    }
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败：' + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const n of ['uRes', 'uTime', 'uLevel', 'uState', 'uVariant', 'uStage']) {
    U[n] = gl.getUniformLocation(prog, n);
  }

  const state = {
    variant: VARIANTS.indexOf(opts.variant ?? 'pearl'),
    phase: 0, // 0 idle / 1 listening / 2 thinking
    level: 0,
    stage: opts.stage ? 1 : 0,   // 全屏铺底 → 暗舞台
    running: true,
  };

  // ⚠️ 体面地在分辨率与帧率之间取舍：这里按 DPR 限制到 1.5，
  //    因为光线步进是**每像素**跑 96 步，4K 下会直接掉到个位数帧。
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }

  let t0 = performance.now();
  let raf = 0;
  let lastCenter = [0, 0, 0];
  let probeTick = 0;
  function frame(now) {
    if (!state.running) return;
    resize();
    // 音量做平滑，避免逐帧跳变看起来"抽搐"
    state.smooth = (state.smooth ?? 0) * 0.82 + state.level * 0.18;
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, (now - t0) / 1000);
    gl.uniform1f(U.uLevel, state.smooth);
    gl.uniform1f(U.uState, state.phase);
    gl.uniform1f(U.uVariant, state.variant);
    gl.uniform1f(U.uStage, state.stage);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 每 20 帧采一次中心像素（同一帧内读，才有内容）
    if (++probeTick % 20 === 0) {
      const px = new Uint8Array(4);
      gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      lastCenter = [px[0], px[1], px[2]];
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    /** 'idle' | 'listening' | 'thinking' */
    setState(name) {
      state.phase = { idle: 0, listening: 1, thinking: 2 }[name] ?? 0;
    },
    /** 0..1，listening 时喂实时音量进来 */
    setLevel(v) {
      state.level = Math.max(0, Math.min(1, v));
    },
    /** 'pearl' | 'stone' | 'lime' */
    setVariant(name) {
      const i = VARIANTS.indexOf(name);
      if (i >= 0) state.variant = i;
    },
    getVariant: () => VARIANTS[state.variant],
    stop() {
      state.running = false;
      cancelAnimationFrame(raf);
    },
    /**
     * 自检用：最后渲染帧的中心像素。
     *
     * ⚠️ 必须在 rAF 里、**紧跟 drawArrays 之后**读。
     * 从外面调用 debugPixel 去 readPixels，在 `preserveDrawingBuffer:false`
     * （默认）下**永远返回全 0** —— 看起来像"渲染成纯黑"，其实是探针读不到缓冲。
     * 这个坑我踩过，所以这里改成每帧顺手存一下。
     */
    debugPixel: () => lastCenter,
  };
}
