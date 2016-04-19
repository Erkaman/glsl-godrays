precision mediump float;

varying vec3 vNormal;
uniform vec3 uColor;

void main() {

    vec3 ambient = 0.7 * uColor;

    float phong = dot(vNormal, vec3(0.71, 0.71, 0) );
    vec3 diffuse = phong * uColor;

    gl_FragColor =vec4(ambient + diffuse, 1.0);
}
