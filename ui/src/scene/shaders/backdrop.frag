#version 300 es
// The white room: an empty, soft-lit gradient void — nothing drawn but light
// (docs/016). Procedural so weather / HDRI can drive it later. Opaque.
precision highp float;
in vec2 v_uv;
uniform float u_scale; // = camera zoom; scales the void so it responds to the wheel dolly
out vec4 o;

vec3 room(vec2 uv) {
  vec2 t = vec2(uv.x, 1.0 - uv.y); // top-origin so the floor brightens toward the bottom
  t = (t - 0.5) / u_scale + 0.5;   // zoom the void coherently with the camera (no more static bg)
  vec3 c0 = vec3(0.902, 0.922, 0.949), c1 = vec3(0.929, 0.945, 0.969),
       c2 = vec3(0.867, 0.894, 0.929), c3 = vec3(0.831, 0.863, 0.910),
       c4 = vec3(0.945, 0.957, 0.976), w = vec3(1.0);
  float y = t.y;
  vec3 g;
  if (y < 0.5)        g = mix(c0, c1, y / 0.5);
  else if (y < 0.7)   g = mix(c1, c2, (y - 0.5) / 0.2);
  else if (y < 0.735) g = mix(c2, c3, (y - 0.7) / 0.035);
  else if (y < 0.8)   g = mix(c3, c4, (y - 0.735) / 0.065);
  else if (y < 0.9)   g = mix(c4, w, (y - 0.8) / 0.1);
  else                g = w;
  // soft cool wash from the upper-left, settling the void
  float d = length((t - vec2(0.58, 0.20)) / vec2(0.9, 0.64));
  g = mix(g, vec3(0.839, 0.863, 0.902), smoothstep(0.38, 1.0, d) * 0.6);
  return g;
}

void main() { o = vec4(room(v_uv), 1.0); }
