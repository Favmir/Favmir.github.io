#version 300 es

layout (location = 0) in vec3 aPos;

uniform vec3 translation;

void main() {
    gl_Position = vec4(aPos+translation, 1.0);
} 