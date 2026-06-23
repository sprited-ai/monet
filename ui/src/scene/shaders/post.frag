#version 300 es
// Fullscreen post overlay, drawn in up to two passes (the node sets the blend mode):
//   u_mode 0 = vignette  → black, alpha rises toward the corners (SRC_ALPHA blend)
//   u_mode 1 = film/TV grain → per-pixel luminance snow (SRC_ALPHA blend)
// Richer read-the-frame post (bloom, true signed grain) is an FBO pass, deferred (docs/016).
precision highp float;
in vec2 v_uv;
uniform int u_mode;
uniform float u_time;
out vec4 o;

// PCG integer hash — no sin, no banding. The old fract(sin(dot)) hash banded on
// GPU precision, which (sampled on a UV grid) read as a repeating "strided" moiré.
// This hashes the native pixel (gl_FragCoord) + a per-frame seed → fine snow that
// boils with no spatial repeat.
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float hash01(uvec2 p, uint f) {
  uint h = pcg(p.x + pcg(p.y + pcg(f)));
  return float(h) * (1.0 / 4294967295.0);
}

void main() {
  if (u_mode == 0) {
    float d = length(v_uv - 0.5);
    o = vec4(0.0, 0.0, 0.0, smoothstep(0.30, 0.92, d) * 0.28);
  } else {
    uint frame = uint(u_time * 60.0);
    float n = hash01(uvec2(gl_FragCoord.xy), frame);
    // Blended SRC_ALPHA toward a per-pixel gray: lifts darks / drops lights a touch.
    // Kept low so it doesn't sparkle on the bright white room.
    o = vec4(vec3(n), 0.022);
  }
}
