#version 300 es
// Ragnarok-style billboard (docs/016): a fixed sprite rectangle placed at a 3D
// world position, kept upright and turned to face the camera. The quad is a fixed
// reference box (feet at its bottom-centre = u_pos); per-clip framing is resolved
// in the fragment shader, so one draw can cross-dissolve two clips of *different*
// framings without the character going translucent at the seam.
layout(location = 0) in vec2 a_pos;  // [0,1]² ; (0,0) = bottom-left
uniform mat4 u_view, u_proj;
uniform vec3 u_pos;   // world position of the feet
uniform vec2 u_quad;  // world (width, height) of the reference box
uniform vec3 u_right; // billboard right (upright; world up = +Y)
out vec2 v_uv;
void main() {
  vec3 up = vec3(0.0, 1.0, 0.0);
  float fx = (a_pos.x - 0.5) * u_quad.x;
  float fy = a_pos.y * u_quad.y;
  vec3 world = u_pos + u_right * fx + up * fy;
  gl_Position = u_proj * u_view * vec4(world, 1.0);
  v_uv = vec2(a_pos.x, 1.0 - a_pos.y); // texture space: y=0 at the top (color half)
}
