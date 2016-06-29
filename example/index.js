'use strict'

/* global requestAnimationFrame */


var bunny = require('bunny')
var mat4 = require('gl-mat4')
var Geometry = require('gl-geometry')
var glShader = require('gl-shader')
var glslify = require('glslify')
var normals = require('normals')
var createMovableCamera = require('gl-movable-camera')
var vec3 = require('gl-vec3')
var vec4 = require('gl-vec4')
var createSkydome = require('gl-skydome-sun')
var shell = require("gl-now")()
var fillScreen = require("a-big-triangle")
var createTexture = require('gl-texture2d')
var createSphere = require('primitive-sphere')
var createPlane = require('primitive-plane')
var createCube = require('primitive-cube')
var geoTransform = require('geo-3d-transform-mat4')
var meshCombine = require('mesh-combine')
var createGui = require('pnp-gui')
var createFBO = require('gl-fbo')

/*
Below comes a modified version of the module "gl-fbo"
It has been modified so that the mag-filter is gl.LINEAR instead of gl.NEAREST.
This change was necessary, otherwise upscaling a smaller "occlusion texture" would result in blocky
artifacts

 */


/*
End of "gl-fbo"
 */


var phongProgram, // does phong shading for every fragment.
    colorProgram, // this program outputs a single color for every fragment covered by the geometry.
    postPassProgram, // does screen space volumetric scattering.
    skydome, bunnyGeom, boxesGeom, sunSphere, planeGeom,
    gui, mouseLeftDownPrev = false;

// Scale of the "occlusion texture" that we are rendering to, in proportion to the full screen size.
// even if it is not 1.0, it doesn't make a very big visual difference.  And by making the "occlusion texture"
// smaller, we can save a lot of performance.
var fboScale = 0.5;
// "occlusion texture".
var fbo;

var totalTime = 0;


// sun direction.
var sunDir = vec3.fromValues(0.958, 0.28, 0)

// movable camera.
var camera = createMovableCamera({
    position: vec3.fromValues(-30.0, 3.0, 260.0),
    viewDir: vec3.fromValues(0.71, 0.51, 0)
});

/*
These variables can be tweaked by the GUI.
 */

var density = { val: 0.00 };
var weight =  { val:0.00 };
var decay =  { val:0.0 };
var exposure = { val: 0.0 };
var numSamples = {val: 0 };
var showGui = {val: false };

function addBox(mesh, scale, translate) {

    var boxesGeom = createCube();

    var model = mat4.create();
    mat4.scale(model, model, scale);

    mat4.translate(model, model, translate);


    var positions = geoTransform(boxesGeom.positions, model);
    var cells = boxesGeom.cells;

    return meshCombine([
        {positions: mesh.positions, cells: mesh.cells},
        {positions: positions, cells: cells}
    ]);
}

function getScreenSpaceSunPos(skydomeVp) {

    /*
    We can find the screen-space sun position by simply multiplying the sun position(which is the same as sunDir )
    by the view and projection matrices and scaling the (x,y) coordinates into a non-negative range.
     */

    var v = vec4.fromValues(sunDir[0], sunDir[1], sunDir[2], 1.0);
    vec4.transformMat4(v, v, skydomeVp.view)
    vec4.transformMat4(v, v, skydomeVp.projection)

    // perspective division
    vec4.scale(v, v, 1.0 / v[3] )

    // scale (x,y) from range [-1,+1] to range [0,+1]
    vec4.add(v, v, [1.0, 1.0, 0.0, 0.0] )
    vec4.scale(v, v, 0.5)

    return [v[0], v[1] ]
}

function restoreDefaultSettings() {
    density.val = 1.0;
    weight.val = 0.01;
    decay.val = 1.0 ;
    exposure.val = 1.0;
    numSamples.val = 100 ;
}

shell.on("gl-init", function () {
    var gl = shell.gl

    gl.enable(gl.DEPTH_TEST);

    gui = new createGui(gl);

    // stanford bunny.
    bunnyGeom = Geometry(gl);

    var model = mat4.create();
    mat4.translate(model, model, [0, 0, 200]);
    var bunnyPositions = geoTransform(bunny.positions, model);



    bunnyGeom.attr('aPosition', bunnyPositions)
    bunnyGeom.attr('aNormal', normals.vertexNormals(bunny.cells, bunnyPositions))
    bunnyGeom.faces(bunny.cells)

    // sun sphere
    sunSphere = createSphere(1, {segments: 30});
    sunSphere = Geometry(gl)
        .attr('aPosition', sunSphere.positions)
        .attr('aNormal', normals.vertexNormals(sunSphere.cells, sunSphere.positions))
        .faces(sunSphere.cells)


    // we combine lots of different boxes into an entire mesh.
    // this is more efficient, since we can render all the boxes in a single drawcall.
    var mesh = {positions: [], cells: []};
    for (var i = -15; i < 19; i += 2) {
        mesh = addBox(mesh, [1, 200, 3], [20, 0, i * 2])
    }
    for (var i = -15; i < 20; i += 5) {
        mesh = addBox(mesh, [1, 3, 200], [20, i * 2, 0])
    }
    for (var i = -10; i < 5; i += 2) {
        mesh = addBox(mesh, [1, 200, 3], [20, 0, 70 + i * 1.5])
    }
    for (var i = -15; i < 17; i += 1) {
        mesh = addBox(mesh, [1, 3, 80], [20, i * 2, 2.5])
    }
    boxesGeom = Geometry(gl)
        .attr('aPosition', mesh.positions)
        .attr('aNormal', normals.vertexNormals(mesh.cells, mesh.positions))
        .faces(mesh.cells)

    // ground plane
    planeGeom = createPlane(1, 1);


    // create model matrix of ground plane.
    model = mat4.create();
    mat4.rotateX(model, model, Math.PI / 2);
    mat4.translate(model, model, [0, 0, 0]);
    mat4.scale(model, model, [1000, 1000, 1]);
    mesh.positions = geoTransform(planeGeom.positions, model);

    // create ground plane geometry.
    mesh.cells = planeGeom.cells;
    planeGeom = Geometry(gl)
        .attr('aPosition', mesh.positions)
        .attr('aNormal', normals.vertexNormals(mesh.cells, mesh.positions))
        .faces(mesh.cells)


    // create skydome geometry.
    skydome = createSkydome(gl)

    // create shaders.
    phongProgram = glShader(gl, glslify('./default.vert'), glslify('./phong.frag'))
    colorProgram = glShader(gl, glslify('./default.vert'), glslify('./color.frag'))
    postPassProgram = glShader(gl, glslify('./post_pass.vert'), glslify('./post_pass.frag'))

    fbo = createFBO(gl, [shell.canvas.width * fboScale, shell.canvas.height * fboScale], {depth: true});
    fbo.color[0].magFilter = gl.LINEAR;

    gl.clearColor(0.0, 0.0, 0.0, 1);

    restoreDefaultSettings();

})

/*
Render scene geometry.

If pass1 is true, render for pass 1. Otherwise, render for pass 2.
Pass 1 and pass 2 are explained below.
 */
function renderGeometry(gl, program, view, projection, pass1) {

    var model = mat4.create()

    program.bind()
    program.uniforms.uModel = model
    program.uniforms.uView = view
    program.uniforms.uProjection = projection

    if (pass1)
        program.uniforms.uColor = [0.0, 0.0, 0.0];

    // render bunny.
    bunnyGeom.bind(program)
    if (!pass1)
        program.uniforms.uColor = [0.7, 0.7, 0.7];
    bunnyGeom.draw()

    // render boxes.
    boxesGeom.bind(program)
    if (!pass1)
        program.uniforms.uColor = [0.3, 0.3, 0.3];

    boxesGeom.draw()

    // render plane.
    planeGeom.bind(program)
    if (!pass1)
        program.uniforms.uColor = [0.3, 0.3, 0.3];
    planeGeom.draw()
}

function renderSun(gl, skydomeVp) {

    // sun model matrix.
    var sunModel = mat4.create()
    mat4.translate(sunModel, sunModel, sunDir)
    var sc = 0.06;
    mat4.scale(sunModel, sunModel, [sc, sc, sc])

    // render sun using the view and projection matrices of the skydome, so that
    // the sun always stays in the same position of the sky.
    colorProgram.bind()
    sunSphere.bind(colorProgram)
    colorProgram.uniforms.uModel = sunModel
    colorProgram.uniforms.uView = skydomeVp.view
    colorProgram.uniforms.uProjection = skydomeVp.projection

    // make the sun a white ball. The volumetric scattering shader renders the rays of the sun
    colorProgram.uniforms.uColor = [1.0, 1.0, 1.0];


    // do not write sunsphere depth to buffer, so that the geometry is always is front of the sun.
    gl.disable(gl.DEPTH_TEST)
    sunSphere.draw()
    gl.enable(gl.DEPTH_TEST)
}


var flag = 0;

shell.on("gl-render", function (t) {

    totalTime += t;


    var gl = shell.gl
    var canvas = shell.canvas;


    /*
     First setup all matrices.
     */

    var projection = mat4.create()

    var scratch = mat4.create()
    var view = camera.view();//camera.view(scratch);

    mat4.perspective(projection, Math.PI / 2, canvas.width / canvas.height, 0.1, 1000.0)


    var skydomeVp = skydome.constructViewProjection({
        view: view,
        projection: projection
    })

    var blackColor = [0.0, 0.0, 0.0]


    /*
     Render pass 1:
      Render all geometry that could occlude the light source as black.
      Normally render light source.

      And render all the above to a texture called the "occlusion texture"

     */


    fbo.bind()

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.viewport(0, 0, canvas.width * fboScale, canvas.height * fboScale)

    renderSun(gl, skydomeVp);

    // render occluding geometry black.
    renderGeometry(gl, colorProgram, view, projection, true)


    gl.bindFramebuffer(gl.FRAMEBUFFER, null)


    /*
     Render pass 2: Render everything normally, to the default framebuffer.

     */


    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.viewport(0, 0, canvas.width, canvas.height)

    skydome.draw({
            view: view,
            projection: projection
        }
        , {sunDirection: sunDir, renderSun: false, lowerColor: blackColor, upperColor: blackColor}
    )

    renderSun(gl, skydomeVp);
    renderGeometry(gl, phongProgram, view, projection, false)


    /*
     Render pass 3.

     Now enable alpha blending, because we will render the volumetric light rays in a fullscreen pass, and
     combine them with the scene rendered in pass 2 by simply using alpha blending.

     Also, as input to pass 3, is the "occlusion texture" that was rendered to in pass 1. This texture is used to
     ensure that unnatural streaks of light do not appear on objects that are occluding the light source.
     */


    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    postPassProgram.bind();
    postPassProgram.uniforms.uOcclusionTexture = fbo.color[0].bind();
    postPassProgram.uniforms.uScreenSpaceSunPos = getScreenSpaceSunPos(skydomeVp);
    postPassProgram.uniforms.uDensity = density.val;
    postPassProgram.uniforms.uWeight = weight.val;
    postPassProgram.uniforms.uDecay = decay.val;
    postPassProgram.uniforms.uExposure = exposure.val;
    postPassProgram.uniforms.uNumSamples = numSamples.val;


    /*
        float density = 1.0;
        float weight = 0.01;
        float decay = 1.0;
        float exposure = 1.0;
        int numSamples = 100;
        */


    // run fullscreen pass.
    fillScreen(gl);

    gl.disable(gl.BLEND);


    var pressed = shell.wasDown("mouse-left");
    var io = {
        mouseLeftDownCur: pressed,
        mouseLeftDownPrev: mouseLeftDownPrev,

        mousePositionCur: shell.mouse,
        mousePositionPrev: shell.prevMouse
    };
    mouseLeftDownPrev = pressed;

    gui.begin(io, "Properties");

    gui.checkbox("Show GUI", showGui);

    if(showGui.val) {
        // larger window, render widgets.
        gui.windowSizes = [240, 200];

        gui.sliderFloat("Density", density, 0, 2.0);
        gui.sliderFloat("Weight", weight, 0, 0.1);
        gui.sliderFloat("Decay", decay, 0.95, 1.05);
        gui.sliderFloat("Exposure", exposure, 0, 2.0);
        gui.sliderInt("numSamples", numSamples, 0, 100);

        if(gui.button("Restore Defaults")) {
            restoreDefaultSettings();
        }

    } else {
        // small window, but no widgets
        gui.windowSizes = [240, 50];
    }

    gui.end(gl, canvas.width, canvas.height);

    ++flag;
})

var cameraDirection = -0.13;
var freeCamera = false;

shell.on("tick", function () {


    if(!freeCamera) {

        // if not free camera, make the camera traverse a set path.

        camera.position[2] += cameraDirection;

        // flip direction if reached edge.
        if(camera.position[2] < -10) {
            cameraDirection *= -1;
        }
        if(camera.position[2] > 260) {
            cameraDirection *= -1;
        }

        camera.position[1] = 5 + 3*Math.sin(totalTime * 0.1);

    } else {
        // if free camera, listen to keyboard and mouse input.

        if (shell.wasDown("mouse-left")) {
            // if interacting with the GUI, do not let the mouse control the camera.
            if (gui.hasMouseFocus())
                return;

            camera.turn(-(shell.mouseX - shell.prevMouseX), +(shell.mouseY - shell.prevMouseY));
        }

        if (shell.wasDown("W")) {
            camera.walk(true);
        } else if (shell.wasDown("S")) {
            camera.walk(false);
        }

        if (shell.wasDown("A")) {
            camera.stride(true);
        } else if (shell.wasDown("D")) {
            camera.stride(false);
        }

        if (shell.wasDown("O")) {
            camera.fly(true);
        } else if (shell.wasDown("L")) {
            camera.fly(false);
        }

        if (shell.wasDown("M")) {
            camera.velocity = 2.5;
        } else {
            camera.velocity = 0.5;
        }

    }

    if (shell.wasDown("mouse-left") && !gui.hasMouseFocus()) {
        // press left mouse button to free the camera.
        freeCamera = true
    }



})
