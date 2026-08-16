'use client'

import { useEffect, useRef } from 'react'

// ── Shaders ───────────────────────────────────────────────────────────────────

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const SPLAT_FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform float u_aspect;
uniform vec3 u_color;
uniform vec2 u_point;
uniform float u_radius;
varying vec2 v_uv;
void main(){
  vec2 p = v_uv - u_point;
  p.x *= u_aspect;
  float sp = exp(-dot(p,p) / u_radius);
  gl_FragColor = vec4(texture2D(u_tex, v_uv).rgb + sp * u_color, 1.0);
}`

const ADVECT_FRAG = `
precision highp float;
uniform sampler2D u_vel;
uniform sampler2D u_src;
uniform float u_dt;
uniform float u_diss;
varying vec2 v_uv;
void main(){
  vec2 vel = texture2D(u_vel, v_uv).xy;
  vec2 prev = clamp(v_uv - vel * u_dt, 0.0, 1.0);
  gl_FragColor = vec4(texture2D(u_src, prev).rgb * u_diss, 1.0);
}`

const DIVERGE_FRAG = `
precision highp float;
uniform sampler2D u_vel;
uniform vec2 u_tx;
varying vec2 v_uv;
void main(){
  float L = texture2D(u_vel, v_uv - vec2(u_tx.x, 0.0)).x;
  float R = texture2D(u_vel, v_uv + vec2(u_tx.x, 0.0)).x;
  float T = texture2D(u_vel, v_uv + vec2(0.0, u_tx.y)).y;
  float B = texture2D(u_vel, v_uv - vec2(0.0, u_tx.y)).y;
  gl_FragColor = vec4(0.5*(R-L+T-B), 0.0, 0.0, 1.0);
}`

const PRESSURE_FRAG = `
precision highp float;
uniform sampler2D u_pres;
uniform sampler2D u_div;
uniform vec2 u_tx;
varying vec2 v_uv;
void main(){
  float L = texture2D(u_pres, v_uv - vec2(u_tx.x, 0.0)).x;
  float R = texture2D(u_pres, v_uv + vec2(u_tx.x, 0.0)).x;
  float T = texture2D(u_pres, v_uv + vec2(0.0, u_tx.y)).x;
  float B = texture2D(u_pres, v_uv - vec2(0.0, u_tx.y)).x;
  float d = texture2D(u_div, v_uv).x;
  gl_FragColor = vec4((L+R+T+B-d)*0.25, 0.0, 0.0, 1.0);
}`

const GRADIENT_FRAG = `
precision highp float;
uniform sampler2D u_pres;
uniform sampler2D u_vel;
uniform vec2 u_tx;
varying vec2 v_uv;
void main(){
  float L = texture2D(u_pres, v_uv - vec2(u_tx.x, 0.0)).x;
  float R = texture2D(u_pres, v_uv + vec2(u_tx.x, 0.0)).x;
  float T = texture2D(u_pres, v_uv + vec2(0.0, u_tx.y)).x;
  float B = texture2D(u_pres, v_uv - vec2(0.0, u_tx.y)).x;
  vec2 v = texture2D(u_vel, v_uv).xy - 0.5*vec2(R-L, T-B);
  gl_FragColor = vec4(v, 0.0, 1.0);
}`

// Skin-pressure touch — barely visible warm impression, never overwhelms
const DISPLAY_FRAG = `
precision highp float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main(){
  vec3 c = texture2D(u_tex, v_uv).rgb;
  float lum = dot(c, vec3(0.28, 0.40, 0.32));
  float a = clamp(lum * 3.5, 0.0, 0.20);
  gl_FragColor = vec4(c, a);
}`

// ── WebGL utilities ────────────────────────────────────────────────────────────

type GL = WebGLRenderingContext

function mkShader(gl: GL, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  return s
}

function mkProgram(gl: GL, frag: string) {
  const p = gl.createProgram()!
  gl.attachShader(p, mkShader(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(p, mkShader(gl, gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(p)
  // Collect uniform locations
  const locs: Record<string, WebGLUniformLocation> = {}
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i)!
    locs[info.name] = gl.getUniformLocation(p, info.name)!
  }
  return { p, locs }
}

interface FBO { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }
interface DFBO { read: FBO; write: FBO; swap(): void }

function mkFBO(gl: GL, w: number, h: number, filter: number): FBO {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.FLOAT, null)
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.viewport(0, 0, w, h)
  gl.clear(gl.COLOR_BUFFER_BIT)
  return { tex, fbo, w, h }
}

function mkDFBO(gl: GL, w: number, h: number, filter: number): DFBO {
  const a = mkFBO(gl, w, h, filter)
  const b = mkFBO(gl, w, h, filter)
  return { read: a, write: b, swap() { [this.read, this.write] = [this.write, this.read] } }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function FluidCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const _canvasRaw = canvasRef.current
    if (!_canvasRaw) return
    const canvas: HTMLCanvasElement = _canvasRaw

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const _glRaw = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    })
    if (!_glRaw) return
    // Re-bind as non-nullable so TypeScript tracks it correctly in nested closures
    const gl: GL = _glRaw as GL

    if (!gl.getExtension('OES_texture_float')) return
    gl.getExtension('OES_texture_float_linear')

    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Programs
    const splatP    = mkProgram(gl, SPLAT_FRAG)
    const advectP   = mkProgram(gl, ADVECT_FRAG)
    const divergeP  = mkProgram(gl, DIVERGE_FRAG)
    const pressureP = mkProgram(gl, PRESSURE_FRAG)
    const gradientP = mkProgram(gl, GRADIENT_FRAG)
    const displayP  = mkProgram(gl, DISPLAY_FRAG)

    // Fullscreen quad
    const quadBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)

    function bindQuad(prog: { p: WebGLProgram }) {
      gl.useProgram(prog.p)
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
      const loc = gl.getAttribLocation(prog.p, 'a_pos')
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    }

    function bindTex(tex: WebGLTexture, unit: number) {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
    }

    function target(fbo: FBO | null) {
      if (fbo) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo)
        gl.viewport(0, 0, fbo.w, fbo.h)
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, canvas.width, canvas.height)
      }
    }

    // FBOs — sim at 128, dye at 512 for visual quality
    const SIM = 128
    const DYE = 512
    const vel  = mkDFBO(gl, SIM, SIM, gl.LINEAR)
    const dye  = mkDFBO(gl, DYE, DYE, gl.LINEAR)
    const pres = mkDFBO(gl, SIM, SIM, gl.NEAREST)
    const div  = mkFBO(gl, SIM, SIM, gl.NEAREST)

    const TX = [1 / SIM, 1 / SIM]

    // Skin-pressure palette — near-background dark warm tones.
    // On #080808 these appear as a barely-perceptible warm impression,
    // like pressing a fingertip into dark silicone.
    type RGB = [number, number, number]
    const PALETTE: RGB[] = [
      [0.24, 0.18, 0.11],  // dark warm — primary touch
      [0.20, 0.15, 0.09],  // slightly cooler dark
      [0.28, 0.21, 0.13],  // warmest (accent-adjacent, very muted)
      [0.18, 0.14, 0.09],  // darkest, near-background
    ]

    function splat(x: number, y: number, dx: number, dy: number, color: RGB, radius = 0.0022) {
      const aspect = canvas.width / canvas.height

      bindQuad(splatP)
      bindTex(vel.read.tex, 0)
      gl.uniform1i(splatP.locs['u_tex'], 0)
      gl.uniform1f(splatP.locs['u_aspect'], aspect)
      gl.uniform2f(splatP.locs['u_point'], x, y)
      gl.uniform3f(splatP.locs['u_color'], dx * 5, dy * 5, 0)
      gl.uniform1f(splatP.locs['u_radius'], radius)
      target(vel.write); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      vel.swap()

      bindTex(dye.read.tex, 0)
      gl.uniform1f(splatP.locs['u_radius'], radius * 4)
      gl.uniform3f(splatP.locs['u_color'], ...color)
      target(dye.write); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      dye.swap()
    }

    function step(dt: number) {
      // Advect velocity — faster decay so the impression recedes like silicone
      bindQuad(advectP)
      bindTex(vel.read.tex, 0); bindTex(vel.read.tex, 1)
      gl.uniform1i(advectP.locs['u_vel'], 0)
      gl.uniform1i(advectP.locs['u_src'], 1)
      gl.uniform1f(advectP.locs['u_dt'], dt)
      gl.uniform1f(advectP.locs['u_diss'], 0.966)
      target(vel.write); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      vel.swap()

      // Advect dye — fades noticeably faster than fluid: skin returns to shape
      bindTex(vel.read.tex, 0); bindTex(dye.read.tex, 1)
      gl.uniform1i(advectP.locs['u_src'], 1)
      gl.uniform1f(advectP.locs['u_diss'], 0.960)
      target(dye.write); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      dye.swap()

      // Divergence
      bindQuad(divergeP)
      bindTex(vel.read.tex, 0)
      gl.uniform1i(divergeP.locs['u_vel'], 0)
      gl.uniform2fv(divergeP.locs['u_tx'], TX)
      target(div); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      // Pressure — 22 Jacobi iterations
      bindQuad(pressureP)
      gl.uniform1i(pressureP.locs['u_div'], 1)
      gl.uniform2fv(pressureP.locs['u_tx'], TX)
      bindTex(div.tex, 1)
      for (let i = 0; i < 22; i++) {
        bindTex(pres.read.tex, 0)
        gl.uniform1i(pressureP.locs['u_pres'], 0)
        target(pres.write); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        pres.swap()
      }

      // Gradient subtract
      bindQuad(gradientP)
      bindTex(pres.read.tex, 0); bindTex(vel.read.tex, 1)
      gl.uniform1i(gradientP.locs['u_pres'], 0)
      gl.uniform1i(gradientP.locs['u_vel'], 1)
      gl.uniform2fv(gradientP.locs['u_tx'], TX)
      target(vel.write); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      vel.swap()
    }

    function render() {
      target(null)
      gl.clear(gl.COLOR_BUFFER_BIT)
      bindQuad(displayP)
      bindTex(dye.read.tex, 0)
      gl.uniform1i(displayP.locs['u_tex'], 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    let colorCycle = 0

    // ── Mouse / touch ──────────────────────────────────────────────────────────
    let lastMouse = { x: -1, y: -1 }

    function normPos(clientX: number, clientY: number): [number, number] {
      return [clientX / window.innerWidth, 1 - clientY / window.innerHeight]
    }

    function onMouseMove(e: MouseEvent) {
      const [x, y] = normPos(e.clientX, e.clientY)
      if (lastMouse.x >= 0) {
        const dx = (x - lastMouse.x) * canvas.width * 0.25
        const dy = (y - lastMouse.y) * canvas.height * 0.25
        if (Math.abs(dx) + Math.abs(dy) > 0.05) {
          colorCycle++
          splat(x, y, dx, dy, PALETTE[colorCycle % PALETTE.length])
        }
      }
      lastMouse = { x, y }
    }

    function onMouseLeave() { lastMouse = { x: -1, y: -1 } }

    // No touchmove listener — mobile gets the idle orbit animation only.
    // Never preventDefault on touch events so native scroll (+ Lenis) works.

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseleave', onMouseLeave)

    // ── Animation loop ─────────────────────────────────────────────────────────
    let prevT = performance.now()
    let rafId: number

    function loop(t: number) {
      const dt = Math.min((t - prevT) / 1000, 0.017)
      prevT = t

      step(dt)
      render()
      rafId = requestAnimationFrame(loop)
    }

    // Tiny ambient splat on load — just enough to hint the effect exists
    splat(0.5, 0.5, 0.04, 0.03, PALETTE[0], 0.0006)

    rafId = requestAnimationFrame(loop)

    // ── Resize ────────────────────────────────────────────────────────────────
    function onResize() {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  )
}
