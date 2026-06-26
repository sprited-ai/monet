#version 300 es
// The white room: an empty, soft-lit gradient void — nothing drawn but light
// (docs/016). Procedural so weather / HDRI can drive it later. Opaque.
//
// On top of the void it blooms a soft, organic *mood aura* behind Monet that carries the voice
// turn-state: tinted in her palette (gold = your turn, terracotta = thinking, ruby = her turn),
// breathing in silence and swelling with the live level. This is the conversation's visualization
// — ambient and environmental, so it never competes with her face for the gaze (it lives behind
// her, not in a UI widget). u_active fades the whole aura in only while voice mode is on.
precision highp float;
in vec2 v_uv;
uniform float u_scale;      // = camera zoom; scales the void so it responds to the wheel dolly
uniform float u_time;       // seconds, for the organic drift + breathing
uniform vec3  u_moodColor;  // turn-state tint (0..1)
uniform float u_moodLevel;  // live level 0..1 (mic / her TTS / thinking shimmer)
uniform float u_active;     // 0..1 — voice mode on (fades the aura in/out)
out vec4 o;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

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

void main() {
  vec2 t = vec2(v_uv.x, 1.0 - v_uv.y); // top-origin, matching room()
  vec3 g = room(v_uv);

  float n = fbm(t * 3.2 + vec2(u_time * 0.045, u_time * 0.03 + 7.0));

  // Mood aura — a soft bloom centered behind Monet's upper body, stretched tall like a halo,
  // textured with slow-drifting fbm so it feels alive rather than a flat gradient.
  float r = length((t - vec2(0.5, 0.5)) / vec2(0.56, 0.74)); // anisotropic → taller than wide
  float bloom = smoothstep(1.25, 0.0, r) * (0.68 + 0.5 * n);

  // breathe in silence (clearly visible base), swell with the level
  float breath = 0.34 + 0.08 * sin(u_time * 1.05);
  float intensity = u_active * (breath + u_moodLevel * 0.7);
  float amt = clamp(bloom * intensity, 0.0, 0.92);
  // Multiply blend — the turn color tints the void like light through stained glass (deepens +
  // saturates) rather than washing toward it (which only lightens). Richer, more sophisticated.
  // Lerp the multiplier from white (no change) to the mood color by the aura amount.
  g *= mix(vec3(1.0), u_moodColor, amt);

  o = vec4(g, 1.0);
}
