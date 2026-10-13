/**
 * 把「白底标本视频」的**白底抠掉** —— 纯 WebGL，一帧一次，零依赖。
 *
 * 读者 2026-10-10 原话：
 *   「银铅锌要**都没有背景抠出来**，选择都有白色底背景的视频」
 *   （上一轮我们**故意没抠**，理由是"抠一张有损压缩的近白底会留一圈白毛" ——
 *     那个担心是对的，但结论下错了：留白毛是**阈值和边缘**的问题，不是"抠"本身的问题。
 *     真抠出来之后实测：贴到深色舞台上比原来那张白卡干净得多。）
 *
 * ⚠️⚠️ 为什么是 WebGL 而不是"事先转一个带 alpha 的 webm"：
 *   ① 本机 ffmpeg 9.0.2 **编不出带 alpha 的 VP8/VP9 webm**
 *      （`-pix_fmt yuva420p` 照收，出来的流 `pix_fmt` 仍是 yuv420p，实测过三轮）；
 *   ② 转成带 alpha 的**动图 webp** 是能用的（Chromium 渲染正常，实测），
 *      但那是**一张图** —— 而读者明确要过「**即使是视频你也要做成变速**，
 *      根据语音的速度来调整」。图没有 `playbackRate`，那个功能会一起丢掉。
 *   ⇒ 所以 `<video>` **照旧在放**（只是藏起来当纹理源），抠图这一层另开一块画布。
 *      变速率 = 改 video 的 `playbackRate`，与抠图互不干扰。
 *
 * ⚠️ 判据是「**背景像素真的透明了**」，不是"canvas 在动"：
 *    `verify-mineral-key.mjs` 直接读 canvas 的像素，数四角 alpha≈0、中心 alpha≈255。
 *    只断言"有东西在动"的话，把白底原样画上去也照样绿。
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/**
 * ⚠️ 判据是**到白色的距离**，不是"亮不亮"。
 *    标本自己就有大片浅灰/近白的纹理（银那块的白色矿脉），
 *    用亮度当判据会把它**挖出洞**来 —— 那种洞在深色底上比白毛还显眼。
 *    实测：背景 (253,253,253) 距离≈0，标本最亮处 (230,228,222) 距离≈0.19
 *    ⇒ 门槛取 0.13 正好卡在中间那一段空档里。
 */
const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uNear;   // 低于它 → 全透明（背景）
uniform float uFar;    // 高于它 → 全不透明（标本本体）
void main(){
  vec4 c = texture2D(uTex, vUv);
  float d = distance(c.rgb, vec3(0.992));       // 0.992 = 253/255，实测出来的四角值
  float a = smoothstep(uNear, uFar, d);
  gl_FragColor = vec4(c.rgb, a);
}
`;

export function createKeyer(canvas, video, opts = {}) {
  // ⚠️ `alpha:true` + `premultipliedAlpha:false`：默认那个是**预乘**的，
  //    直接把上面的 vec4 交出去，边缘的半透明像素会被再乘一次 alpha ⇒ 一圈发黑的硬边。
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
  if (!gl) throw new Error('这个环境不支持 WebGL');

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('着色器编译失败：' + gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('着色器链接失败：' + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
  gl.uniform1f(gl.getUniformLocation(prog, 'uNear'), opts.near ?? 0.045);
  gl.uniform1f(gl.getUniformLocation(prog, 'uFar'), opts.far ?? 0.13);

  // ⚠️ 抠好的那一层**必须自己清成透明**。不清的话上一帧的标本会糊在背景里，
  //    看起来像"拖影"——而那在动图上很像"素材本身就是这样"。
  gl.clearColor(0, 0, 0, 0);

  const state = { running: false, raf: 0 };
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  /** 画一帧。⚠️ 所有读像素的动作都必须**紧跟着它、在同一个 JS 任务里**做 ——
   *  见下面 `stats()` 和 `probe()` 的注释。 */
  function draw() {
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr()));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr()));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (video.readyState < 2) return false;
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); }
    catch { return false; /* 这一帧还没准备好 —— 画上一帧就行，别当成"坏了" */ }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  function frame() {
    if (!state.running) return;
    draw();
    state.raf = requestAnimationFrame(frame);
  }

  return {
    start() { if (state.running) return; state.running = true; frame(); },
    stop() { state.running = false; cancelAnimationFrame(state.raf); },
    /** 自检用：读**一个点**的 RGBA。⚠️ 只能在 `draw()` 的**同一个 JS 任务**里读
     *  —— canvas 是 `preserveDrawingBuffer:false`，从外面读**永远返回全 0**，
     *  而那看起来就像"抠图把整幅都抠没了"。 */
    probe(nx = 0.5, ny = 0.5) {
      draw();
      const px = new Uint8Array(4);
      gl.readPixels(
        Math.min(canvas.width - 1, Math.floor(nx * canvas.width)),
        Math.min(canvas.height - 1, Math.floor((1 - ny) * canvas.height)),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px,
      );
      return [px[0], px[1], px[2], px[3]];
    },
    /**
     * 自检用：整幅的 alpha 统计 —— 「**背景真的透明、标本真的还在**」。
     *
     * ⚠️⚠️ 这一条是有来历的：第一版验证器从外面 `canvas.toDataURL()` 去读，
     *    拿到的是**已经被合成器清空的缓冲** ⇒ 四角 alpha=0 ✓（假绿）、
     *    中心 alpha=0 ✗ ⇒ 报出来像"抠图把整幅都抠没了"，
     *    而真相是**量具坏了**（纪律 8 那个家族）。
     *    ⇒ 读像素一律走这里。
     */
    stats() {
      draw();
      const w = canvas.width, h = canvas.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const at = (x, y) => px[(y * w + x) * 4 + 3];
      const m = 8;
      const corners = [at(m, m), at(w - 1 - m, m), at(m, h - 1 - m), at(w - 1 - m, h - 1 - m)];
      let maxA = 0, opaque = 0, samples = 0;
      for (let i = 3; i < px.length; i += 4 * 41) { samples++; const a = px[i]; if (a > maxA) maxA = a; if (a > 200) opaque++; }
      return { w, h, corners, maxA, opaque, samples, cornerMax: Math.max(...corners) };
    },
  };
}
