#version 300 es
// Fullscreen post overlay, drawn in up to two passes (the node sets the blend mode):
//   u_mode 0 = vignette  → black, alpha rises toward the corners (SRC_ALPHA blend)
//   u_mode 1 = film grain → subtle additive noise (ONE,ONE blend; brighten-only at 8-bit)
// True read-the-frame post (proper grain, bloom) is an FBO pass, deferred (docs/016).
precision highp float;
in vec2 v_uv;
uniform int u_mode;
uniform float u_time;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  if (u_mode == 0) {
    float d = length(v_uv - 0.5);
    float darken = smoothstep(0.30, 0.92, d) * 0.28;
    o = vec4(0.0, 0.0, 0.0, darken);
  } else {
    float g = hash(v_uv * 640.0 + fract(u_time) * 64.0);
    o = vec4(vec3(g * 0.05), 1.0);
  }
}
