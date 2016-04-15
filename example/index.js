'use strict'

/* global requestAnimationFrame */


var bunny = require('bunny')
var mat4 = require('gl-mat4')
var Geometry = require('gl-geometry')
var glShader = require('gl-shader')
var glslify = require('glslify')
var normals = require('normals')
var createOrbitCamera = require('orbit-camera')
var createMovableCamera = require('gl-movable-camera')

var vec3 = require('gl-vec3')
var vec4 = require('gl-vec4')
var createSkydome = require('gl-skydome-sun')
var shell = require("gl-now")()
var createFbo = require("gl-fbo")
var fillScreen = require("a-big-triangle")
var createTexture = require('gl-texture2d')
var createSphere = require('primitive-sphere')
var createBox = require('geo-3d-box')
var createPlane = require('primitive-plane')

var createCube = require('primitive-cube')
var geoTransform = require('geo-3d-transform-mat4')
var meshCombine = require('mesh-combine')
var quat = require('gl-quat')
var rotateVectorAboutAxis = require('rotate-vector-about-axis')




var phongProgram, // does phong shading for every fragment.
    colorProgram, // this program outputs a single color for every fragment covered by the geometry.
    postPassProgram,
    skydome,bunnyGeom, boxesGeom, sunSphere, planeGeom

var fboDiv = 1;

var sunDir = vec3.fromValues(0.958, 0.28, 0)



/*
var camera = createOrbitCamera()
camera.center = [0, 4, 0];
camera.distance = 32;
camera.rotation = [0.10503429174423218, -0.8922743797302246, 0.18369752168655396, 0.3988351821899414]
*/

/*
var cameraPos = vec3.fromValues(-30.0, -9.0, -7.0);
var cameraViewDir = sunDir;
*/

var camera = createMovableCamera( {position: vec3.fromValues(-30.0, 3.0, -7.0), viewDir:  vec3.fromValues(0.71, 0.51, 0) } );


var outFbo;

function addBox(mesh, scale, translate) {

    var boxesGeom = createCube();

    var model = mat4.create();
    mat4.scale(model, model, scale);

    mat4.translate(model, model, translate);


    var positions = geoTransform(boxesGeom.positions , model);
    var cells = boxesGeom.cells;

     return meshCombine(  [
        {positions : mesh.positions, cells: mesh.cells },
        {positions : positions, cells: cells }
    ] );
}



shell.on("gl-init", function () {
    var gl = shell.gl

    gl.enable(gl.DEPTH_TEST)


    bunnyGeom = Geometry(gl)
    bunnyGeom.attr('aPosition', bunny.positions)
    bunnyGeom.attr('aNormal', normals.vertexNormals(bunny.cells, bunny.positions))
    bunnyGeom.faces(bunny.cells)


    sunSphere = createSphere(1, {segments: 30} );
    sunSphere = Geometry(gl)
        .attr('aPosition', sunSphere.positions)
        .attr('aNormal', normals.vertexNormals(sunSphere.cells, sunSphere.positions))
        .faces(sunSphere.cells)


    var mesh = {positions : [], cells: [] };


    for(var i = -15; i < 19; i += 2) {
        mesh = addBox(mesh, [1,200,3], [20,0,i*2] )

    }

    for(var i = -15; i < 20; i += 5) {
        mesh = addBox(mesh, [1,3,200], [20,i*2,0] )

    }

    boxesGeom = Geometry(gl)
        .attr('aPosition', mesh.positions  )
        .attr('aNormal',  normals.vertexNormals(mesh.cells, mesh.positions) )
        .faces(mesh.cells)




    planeGeom = createPlane(1,1);

    var model = mat4.create();

    mat4.rotateX(model, model, Math.PI/2);

    mat4.translate(model, model, [0,0,0]);
    mat4.scale(model, model, [1000,1000,1]);

    mesh.positions = geoTransform(planeGeom.positions , model);
   // mesh.positions = planeGeom.positions;
    mesh.cells = planeGeom.cells;

    planeGeom = Geometry(gl)
        .attr('aPosition', mesh.positions  )
        .attr('aNormal',  normals.vertexNormals(mesh.cells, mesh.positions) )
        .faces(mesh.cells)



    phongProgram = glShader(gl, glslify('./default.vert'), glslify('./phong.frag'))
    colorProgram = glShader(gl, glslify('./default.vert'), glslify('./color.frag'))
    postPassProgram = glShader(gl, glslify('./post_pass.vert'), glslify('./post_pass.frag'))

    skydome = createSkydome(gl )

    outFbo = createFbo(gl, [shell.canvas.width/fboDiv, shell.canvas.height/fboDiv], {depth: true} );

    outFbo.bind()



  //  gl.clearColor(0.0,0.0,0.0, 1)




})


var printedOnce = false;



// render all geometry that is not the skydome using a shader.
function renderGeometry(gl, program, view, projection, pass1) {

    var model = mat4.create()

    program.bind()
    program.uniforms.uModel = model
    program.uniforms.uView = view
    program.uniforms.uProjection = projection

    if(pass1)
        program.uniforms.uColor = [0.0, 0.0, 0.0];


    bunnyGeom.bind(program)
    if(!pass1)
        program.uniforms.uColor = [0.7, 0.7, 0.7];
    bunnyGeom.draw()


    boxesGeom.bind(program)
    if(!pass1)
        program.uniforms.uColor = [0.3, 0.3, 0.3];

    boxesGeom.draw()


    planeGeom.bind(program)
    if(!pass1)
        program.uniforms.uColor = [0.3, 0.3, 0.3];
    planeGeom.draw()
}

function renderSun(gl, skydomeVp) {
    var sunModel = mat4.create()
    mat4.translate(sunModel, sunModel, sunDir )

    var sc = 0.06;
    mat4.scale(sunModel, sunModel, [sc, sc, sc] )

    colorProgram.bind()
    sunSphere.bind(colorProgram)
    colorProgram.uniforms.uModel = sunModel
    colorProgram.uniforms.uView = skydomeVp.view
    colorProgram.uniforms.uProjection = skydomeVp.projection
    colorProgram.uniforms.uColor = [1.0, 1.0, 1.0];


    // do not write sunsphere depth to buffer, so that the geometry is always is front of the sun.
    gl.disable(gl.DEPTH_TEST)
    sunSphere.draw()
    gl.enable(gl.DEPTH_TEST)



}

shell.on("gl-render", function (t) {

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

    //var skycolor = [0.0, 0.4, 0.9];

    var skycolor = [0.0, 0.0, 0];



    /*
    Render pass 1: normally render skybox, normally render sun, render occluding geometry black.
    render to fbo.

     */


    outFbo.bind()
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.viewport(0, 0, canvas.width/fboDiv, canvas.height/fboDiv)



    skydome.draw({
        view: view,
        projection: projection
    }
        ,  {sunDirection : sunDir, sunColor: [1.0, 1.0, 1.0],lowerColor: skycolor, upperColor: skycolor, sunSize: 10,
        renderSun: false}
    )



    renderSun(gl, skydomeVp);
    renderGeometry(gl, colorProgram, view, projection, true)




   gl.bindFramebuffer(gl.FRAMEBUFFER, null)





    /*
     Render pass 2: normally render skybox, DONT render sun, render occluding geometry with lighting
     render to default framebuffer. .

     */



    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.viewport(0, 0, canvas.width, canvas.height)


    skydome.draw({
            view: view,
            projection: projection
        }
          ,  {sunDirection : sunDir, renderSun : false, lowerColor: skycolor, upperColor: skycolor  }
    )


    renderSun(gl, skydomeVp);


    renderGeometry(gl, phongProgram, view, projection, false)




    /*
    Render pass 3
     */



    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);


    postPassProgram.bind();
    postPassProgram.uniforms.uBuffer = outFbo.color[0].bind();


    postPassProgram.uniforms.uSunDir = sunDir
    postPassProgram.uniforms.uView = skydomeVp.view
    postPassProgram.uniforms.uProjection = skydomeVp.projection


    fillScreen(gl);

    gl.disable(gl.BLEND);

    

})

shell.on("tick", function() {

   // camera.control(shell.mouseX - shell.prevMouseX, shell.mouseY - shell.prevMouseY);

    if(shell.wasDown("mouse-left")) {

        camera.turn(  -(shell.mouseX - shell.prevMouseX), +(shell.mouseY - shell.prevMouseY) );
    }

    if(shell.wasDown("W")) {
        camera.walk(true);
    } else if(shell.wasDown("S")) {
        camera.walk(false);
    }

    if(shell.wasDown("A")) {
        camera.stride(true);
    } else if(shell.wasDown("D")) {
        camera.stride(false);
    }

    if(shell.wasDown("O")) {
        camera.fly(true);
    } else if(shell.wasDown("L")) {
        camera.fly(false);
    }

    if(shell.wasDown("M")) {
        camera.velocity = 2.5;
    } else {
        camera.velocity = 0.5;
    }

})
