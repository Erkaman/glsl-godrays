precision highp float;


#pragma glslify: godrays = require(../index.glsl)



uniform sampler2D uOcclusionTexture;
varying vec2 vUv;

uniform vec2 uScreenSpaceSunPos;

void main() {

    float density = 1.0;
    float weight = 0.01;
    float decay = 1.0;
    float exposure = 1.0;
    int numSamples = 100;

vec3 fragColor = godrays(
    density,
    weight,
    decay,
    exposure,
    numSamples,
    uOcclusionTexture,
    uScreenSpaceSunPos,
    vUv
    );

    gl_FragColor = vec4(fragColor , 1.0);
}