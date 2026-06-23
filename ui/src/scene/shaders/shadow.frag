#version 300 es
// Soft round contact shadow. Alpha-blended dark blob, fading to nothing at the rim.
precision highp float;
in vec2 v_uv;
uniform float u_strength;
out vec4 o;
void main() {
  float d = length(v_uv);
  float a = (1.0 - smoothstep(0.0, 1.0, d)) * u_strength;
  o = vec4(0.0, 0.0, 0.0, a * 0.32);
}
