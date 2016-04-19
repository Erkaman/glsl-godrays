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
//var createFBO = require("gl-fbo")
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


var colorAttachmentArrays = null
var FRAMEBUFFER_UNSUPPORTED
var FRAMEBUFFER_INCOMPLETE_ATTACHMENT
var FRAMEBUFFER_INCOMPLETE_DIMENSIONS
var FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT

function saveFBOState(gl) {
    var fbo = gl.getParameter(gl.FRAMEBUFFER_BINDING)
    var rbo = gl.getParameter(gl.RENDERBUFFER_BINDING)
    var tex = gl.getParameter(gl.TEXTURE_BINDING_2D)
    return [fbo, rbo, tex]
}

function restoreFBOState(gl, data) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, data[0])
    gl.bindRenderbuffer(gl.RENDERBUFFER, data[1])
    gl.bindTexture(gl.TEXTURE_2D, data[2])
}

function lazyInitColorAttachments(gl, ext) {
    var maxColorAttachments = gl.getParameter(ext.MAX_COLOR_ATTACHMENTS_WEBGL)
    colorAttachmentArrays = new Array(maxColorAttachments + 1)
    for (var i = 0; i <= maxColorAttachments; ++i) {
        var x = new Array(maxColorAttachments)
        for (var j = 0; j < i; ++j) {
            x[j] = gl.COLOR_ATTACHMENT0 + j
        }
        for (var j = i; j < maxColorAttachments; ++j) {
            x[j] = gl.NONE
        }
        colorAttachmentArrays[i] = x
    }
}

//Throw an appropriate error
function throwFBOError(status) {
    switch (status) {
        case FRAMEBUFFER_UNSUPPORTED:
            throw new Error('gl-fbo: Framebuffer unsupported')
        case FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
            throw new Error('gl-fbo: Framebuffer incomplete attachment')
        case FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
            throw new Error('gl-fbo: Framebuffer incomplete dimensions')
        case FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
            throw new Error('gl-fbo: Framebuffer incomplete missing attachment')
        default:
            throw new Error('gl-fbo: Framebuffer failed for unspecified reason')
    }
}

//Initialize a texture object
function initTexture(gl, width, height, type, format, attachment) {
    if (!type) {
        return null
    }
    var result = createTexture(gl, width, height, format, type)
    result.magFilter = gl.LINEAR
    result.minFilter = gl.LINEAR
    result.mipSamples = 1
    result.bind()
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, result.handle, 0)
    return result
}

//Initialize a render buffer object
function initRenderBuffer(gl, width, height, component, attachment) {
    var result = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, result)
    gl.renderbufferStorage(gl.RENDERBUFFER, component, width, height)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, result)
    return result
}

//Rebuild the frame buffer
function rebuildFBO(fbo) {

    //Save FBO state
    var state = saveFBOState(fbo.gl)

    var gl = fbo.gl
    var handle = fbo.handle = gl.createFramebuffer()
    var width = fbo._shape[0]
    var height = fbo._shape[1]
    var numColors = fbo.color.length
    var ext = fbo._ext
    var useStencil = fbo._useStencil
    var useDepth = fbo._useDepth
    var colorType = fbo._colorType

    //Bind the fbo
    gl.bindFramebuffer(gl.FRAMEBUFFER, handle)

    //Allocate color buffers
    for (var i = 0; i < numColors; ++i) {
        fbo.color[i] = initTexture(gl, width, height, colorType, gl.RGBA, gl.COLOR_ATTACHMENT0 + i)
    }
    if (numColors === 0) {
        fbo._color_rb = initRenderBuffer(gl, width, height, gl.RGBA4, gl.COLOR_ATTACHMENT0)
        if (ext) {
            ext.drawBuffersWEBGL(colorAttachmentArrays[0])
        }
    } else if (numColors > 1) {
        ext.drawBuffersWEBGL(colorAttachmentArrays[numColors])
    }

    //Allocate depth/stencil buffers
    var WEBGL_depth_texture = gl.getExtension('WEBGL_depth_texture')
    if (WEBGL_depth_texture) {
        if (useStencil) {
            fbo.depth = initTexture(gl, width, height,
                WEBGL_depth_texture.UNSIGNED_INT_24_8_WEBGL,
                gl.DEPTH_STENCIL,
                gl.DEPTH_STENCIL_ATTACHMENT)
        } else if (useDepth) {
            fbo.depth = initTexture(gl, width, height,
                gl.UNSIGNED_SHORT,
                gl.DEPTH_COMPONENT,
                gl.DEPTH_ATTACHMENT)
        }
    } else {
        if (useDepth && useStencil) {
            fbo._depth_rb = initRenderBuffer(gl, width, height, gl.DEPTH_STENCIL, gl.DEPTH_STENCIL_ATTACHMENT)
        } else if (useDepth) {
            fbo._depth_rb = initRenderBuffer(gl, width, height, gl.DEPTH_COMPONENT16, gl.DEPTH_ATTACHMENT)
        } else if (useStencil) {
            fbo._depth_rb = initRenderBuffer(gl, width, height, gl.STENCIL_INDEX, gl.STENCIL_ATTACHMENT)
        }
    }

    //Check frame buffer state
    var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    if (status !== gl.FRAMEBUFFER_COMPLETE) {

        //Release all partially allocated resources
        fbo._destroyed = true

        //Release all resources
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.deleteFramebuffer(fbo.handle)
        fbo.handle = null
        if (fbo.depth) {
            fbo.depth.dispose()
            fbo.depth = null
        }
        if (fbo._depth_rb) {
            gl.deleteRenderbuffer(fbo._depth_rb)
            fbo._depth_rb = null
        }
        for (var i = 0; i < fbo.color.length; ++i) {
            fbo.color[i].dispose()
            fbo.color[i] = null
        }
        if (fbo._color_rb) {
            gl.deleteRenderbuffer(fbo._color_rb)
            fbo._color_rb = null
        }

        restoreFBOState(gl, state)

        //Throw the frame buffer error
        throwFBOError(status)
    }

    //Everything ok, let's get on with life
    restoreFBOState(gl, state)
}

function Framebuffer(gl, width, height, colorType, numColors, useDepth, useStencil, ext) {

    //Handle and set properties
    this.gl = gl
    this._shape = [width | 0, height | 0]
    this._destroyed = false
    this._ext = ext

    //Allocate buffers
    this.color = new Array(numColors)
    for (var i = 0; i < numColors; ++i) {
        this.color[i] = null
    }
    this._color_rb = null
    this.depth = null
    this._depth_rb = null

    //Save depth and stencil flags
    this._colorType = colorType
    this._useDepth = useDepth
    this._useStencil = useStencil

    //Shape vector for resizing
    var parent = this
    var shapeVector = [width | 0, height | 0]
    Object.defineProperties(shapeVector, {
        0: {
            get: function () {
                return parent._shape[0]
            },
            set: function (w) {
                return parent.width = w
            }
        },
        1: {
            get: function () {
                return parent._shape[1]
            },
            set: function (h) {
                return parent.height = h
            }
        }
    })
    this._shapeVector = shapeVector

    //Initialize all attachments
    rebuildFBO(this)
}

var proto = Framebuffer.prototype

function reshapeFBO(fbo, w, h) {
    //If fbo is invalid, just skip this
    if (fbo._destroyed) {
        throw new Error('gl-fbo: Can\'t resize destroyed FBO')
    }

    //Don't resize if no change in shape
    if ((fbo._shape[0] === w) &&
        (fbo._shape[1] === h)) {
        return
    }

    var gl = fbo.gl

    //Check parameter ranges
    var maxFBOSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)
    if (w < 0 || w > maxFBOSize ||
        h < 0 || h > maxFBOSize) {
        throw new Error('gl-fbo: Can\'t resize FBO, invalid dimensions')
    }

    //Update shape
    fbo._shape[0] = w
    fbo._shape[1] = h

    //Save framebuffer state
    var state = saveFBOState(gl)

    //Resize framebuffer attachments
    for (var i = 0; i < fbo.color.length; ++i) {
        fbo.color[i].shape = fbo._shape
    }
    if (fbo._color_rb) {
        gl.bindRenderbuffer(gl.RENDERBUFFER, fbo._color_rb)
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, fbo._shape[0], fbo._shape[1])
    }
    if (fbo.depth) {
        fbo.depth.shape = fbo._shape
    }
    if (fbo._depth_rb) {
        gl.bindRenderbuffer(gl.RENDERBUFFER, fbo._depth_rb)
        if (fbo._useDepth && fbo._useStencil) {
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, fbo._shape[0], fbo._shape[1])
        } else if (fbo._useDepth) {
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, fbo._shape[0], fbo._shape[1])
        } else if (fbo._useStencil) {
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX, fbo._shape[0], fbo._shape[1])
        }
    }

    //Check FBO status after resize, if something broke then die in a fire
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.handle)
    var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        fbo.dispose()
        restoreFBOState(gl, state)
        throwFBOError(status)
    }

    //Restore framebuffer state
    restoreFBOState(gl, state)
}

Object.defineProperties(proto, {
    'shape': {
        get: function () {
            if (this._destroyed) {
                return [0, 0]
            }
            return this._shapeVector
        },
        set: function (x) {
            if (!Array.isArray(x)) {
                x = [x | 0, x | 0]
            }
            if (x.length !== 2) {
                throw new Error('gl-fbo: Shape vector must be length 2')
            }

            var w = x[0] | 0
            var h = x[1] | 0
            reshapeFBO(this, w, h)

            return [w, h]
        },
        enumerable: false
    },
    'width': {
        get: function () {
            if (this._destroyed) {
                return 0
            }
            return this._shape[0]
        },
        set: function (w) {
            w = w | 0
            reshapeFBO(this, w, this._shape[1])
            return w
        },
        enumerable: false
    },
    'height': {
        get: function () {
            if (this._destroyed) {
                return 0
            }
            return this._shape[1]
        },
        set: function (h) {
            h = h | 0
            reshapeFBO(this, this._shape[0], h)
            return h
        },
        enumerable: false
    }
})

proto.bind = function () {
    if (this._destroyed) {
        return
    }
    var gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.handle)
    gl.viewport(0, 0, this._shape[0], this._shape[1])
}

proto.dispose = function () {
    if (this._destroyed) {
        return
    }
    this._destroyed = true
    var gl = this.gl
    gl.deleteFramebuffer(this.handle)
    this.handle = null
    if (this.depth) {
        this.depth.dispose()
        this.depth = null
    }
    if (this._depth_rb) {
        gl.deleteRenderbuffer(this._depth_rb)
        this._depth_rb = null
    }
    for (var i = 0; i < this.color.length; ++i) {
        this.color[i].dispose()
        this.color[i] = null
    }
    if (this._color_rb) {
        gl.deleteRenderbuffer(this._color_rb)
        this._color_rb = null
    }
}

function createFBO(gl, width, height, options) {

    //Update frame buffer error code values
    if (!FRAMEBUFFER_UNSUPPORTED) {
        FRAMEBUFFER_UNSUPPORTED = gl.FRAMEBUFFER_UNSUPPORTED
        FRAMEBUFFER_INCOMPLETE_ATTACHMENT = gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
        FRAMEBUFFER_INCOMPLETE_DIMENSIONS = gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS
        FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT = gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT
    }

    //Lazily initialize color attachment arrays
    var WEBGL_draw_buffers = gl.getExtension('WEBGL_draw_buffers')
    if (!colorAttachmentArrays && WEBGL_draw_buffers) {
        lazyInitColorAttachments(gl, WEBGL_draw_buffers)
    }

    //Special case: Can accept an array as argument
    if (Array.isArray(width)) {
        options = height
        height = width[1] | 0
        width = width[0] | 0
    }

    if (typeof width !== 'number') {
        throw new Error('gl-fbo: Missing shape parameter')
    }

    //Validate width/height properties
    var maxFBOSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)
    if (width < 0 || width > maxFBOSize || height < 0 || height > maxFBOSize) {
        throw new Error('gl-fbo: Parameters are too large for FBO')
    }

    //Handle each option type
    options = options || {}

    //Figure out number of color buffers to use
    var numColors = 1
    if ('color' in options) {
        numColors = Math.max(options.color | 0, 0)
        if (numColors < 0) {
            throw new Error('gl-fbo: Must specify a nonnegative number of colors')
        }
        if (numColors > 1) {
            //Check if multiple render targets supported
            if (!WEBGL_draw_buffers) {
                throw new Error('gl-fbo: Multiple draw buffer extension not supported')
            } else if (numColors > gl.getParameter(WEBGL_draw_buffers.MAX_COLOR_ATTACHMENTS_WEBGL)) {
                throw new Error('gl-fbo: Context does not support ' + numColors + ' draw buffers')
            }
        }
    }

    //Determine whether to use floating point textures
    var colorType = gl.UNSIGNED_BYTE
    var OES_texture_float = gl.getExtension('OES_texture_float')
    if (options.float && numColors > 0) {
        if (!OES_texture_float) {
            throw new Error('gl-fbo: Context does not support floating point textures')
        }
        colorType = gl.FLOAT
    } else if (options.preferFloat && numColors > 0) {
        if (OES_texture_float) {
            colorType = gl.FLOAT
        }
    }

    //Check if we should use depth buffer
    var useDepth = true
    if ('depth' in options) {
        useDepth = !!options.depth
    }

    //Check if we should use a stencil buffer
    var useStencil = false
    if ('stencil' in options) {
        useStencil = !!options.stencil
    }

    return new Framebuffer(
        gl,
        width,
        height,
        colorType,
        numColors,
        useDepth,
        useStencil,
        WEBGL_draw_buffers)

}


var phongProgram, // does phong shading for every fragment.
    colorProgram, // this program outputs a single color for every fragment covered by the geometry.
    postPassProgram, // does screen space volumetric scattering.
    skydome, bunnyGeom, boxesGeom, sunSphere, planeGeom

// Scale of the FBO that we are rendering to, in proportion to the full screen size.
var fboScale = 0.5;
// fbo that we are rendering to.
var fbo;


// sun direction.
var sunDir = vec3.fromValues(0.958, 0.28, 0)

// movable camera.
var camera = createMovableCamera({
    position: vec3.fromValues(-30.0, 3.0, -7.0),
    viewDir: vec3.fromValues(0.71, 0.51, 0)
});


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

shell.on("gl-init", function () {
    var gl = shell.gl

    gl.enable(gl.DEPTH_TEST)


    // stanford bunny.
    bunnyGeom = Geometry(gl)
    bunnyGeom.attr('aPosition', bunny.positions)
    bunnyGeom.attr('aNormal', normals.vertexNormals(bunny.cells, bunny.positions))
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
    var model = mat4.create();
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

    gl.clearColor(0.0, 0.0, 0.0, 1)

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

    var blackColor = [0.0, 0.0, 0.0]


    /*
     Render pass 1:
      Render geometry that occludes the light source as black.
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
     combine it with the scene rendered in pass 2 by simply using alpha blending.

     Also, as input to pass 3, is the "occlusion texture" that was rendered to in pass 1. This texture is used to
     ensure that unnatural streaks of light do not appear on objects that are occluding the light source.
     */


    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);


    postPassProgram.bind();
    postPassProgram.uniforms.uBuffer = fbo.color[0].bind();
    postPassProgram.uniforms.uSunDir = sunDir
    postPassProgram.uniforms.uView = skydomeVp.view
    postPassProgram.uniforms.uProjection = skydomeVp.projection

    fillScreen(gl);

    gl.disable(gl.BLEND);


})

shell.on("tick", function () {

    if (shell.wasDown("mouse-left")) {

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

})
