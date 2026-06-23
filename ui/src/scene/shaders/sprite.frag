#version 300 es
// Stacked-alpha sample + cross-dissolve, ported from the proven /preview Stage
// (docs/008). Per-clip framing (anchor + scale + frame aspect) is resolved here,
// so two clips of different framings share one quad. The two slots are mixed in
// PREMULTIPLIED space to a single coverage — the character never goes translucent
// at a clip seam (the "ghost" bug). u_ambient is the room-light tint (HDRI hook);
// straight-alpha out, the framebuffer blend composites it over the room.
precision highp float;
in vec2 v_uv;
uniform sampler2D tA, tB;
uniform float mixv, feather, quadAspect, sclA, sclB, fasA, fasB;
uniform vec2 ancA, ancB, base;
uniform vec3 u_ambient;
out vec4 o;

// Map the quad uv into one clip's frame (feet anchor + framing scale + /fas for
// non-square frames), then read color (top half) / alpha (bottom half).
vec4 stk(sampler2D t, vec2 anc, float scl, float fas) {
  float k = scl;
  vec2 u = vec2(anc.x + (v_uv.x - 0.5) * quadAspect / (k * fas),
                anc.y + (v_uv.y - base.y) / k);
  if (u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0) return vec4(0.0);
  vec3 rgb = texture(t, vec2(u.x, u.y * 0.5)).rgb;
  float a = texture(t, vec2(u.x, 0.5 + u.y * 0.5)).r;
  float e = smoothstep(0.0, feather, u.x) * smoothstep(0.0, feather, 1.0 - u.x)
          * smoothstep(0.0, feather, u.y) * smoothstep(0.0, feather, 1.0 - u.y);
  return vec4(rgb, a * e);
}

void main() {
  vec4 a = stk(tA, ancA, sclA, fasA);
  vec4 b = stk(tB, ancB, sclB, fasB);
  // Premultiplied mix → one correct alpha. A transparent texel (a==0) carries
  // garbage rgb; premultiplying makes it contribute nothing, so the incoming clip
  // fades in cleanly. Un-premultiply for the straight-alpha output.
  vec4 m = mix(vec4(a.rgb * a.a, a.a), vec4(b.rgb * b.a, b.a), mixv);
  if (m.a <= 0.0001) discard;
  o = vec4((m.rgb / m.a) * u_ambient, m.a);
}
