/*
Homework 06, Computer Graphics (CAS3205.01-00), Fall 2025
Due date: 2025년 10월 23일 (목) 자정

문제: 13_Texture 프로그램을 고쳐서 Homework 05에서 작성한 사각뿔 (squared pyramid)에 texture image "sunrise.jpg" 를 입력 rendering하고, arcball로 control할 수 있는 프로그램을 작성합니다. 다음의 조건을 만족해야 합니다.

처음 실행했을 때, canvas의 크기는 700 × 700 이어야 합니다.

사각뿔의 위치와 크기는 모두 Homework 05 때와 같습니다.

Texture 이미지는 이미지 한 장이 4개 면에 걸쳐 wrapping됩니다. 즉, 옆면 각 face에 이미지 한 장이 아니라는 뜻입니다.

밑면은 Texture 이미지 전체를 mapping에 사용합니다.

squaredPyramid.js는 …/util 이 아니라 반드시 Homework06 folder 안에 두도록 합니다.

제출물:

Source code인 html, js, shader, texture 파일들을 하나의 zip으로 묶어 첨부파일로 제출.
 Zip 파일명은 hw06_학번.zip 으로 함 (예: hw06_2013999888.zip)

LearnUs 답안 글 작성 란에
 A. 프로그램을 browsing할 수 있는 url을 hyperlink로 제출 (click하면 새 창이 뜨면서 browsing되도록)
 B. 팀별로의 학번, 이름을 적을 것

*/


/*-----------------------------------------------------------------------------------
13_Texture.js

- Viewing a 3D unit cube at origin with perspective projection
- Rotate by ArcBall interface (by left mouse button dragging)
- Applying image texture
-----------------------------------------------------------------------------------*/

import { resizeAspectRatio, Axes } from './util/util.js';
import { Shader, readShaderFile } from './util/shader.js';
import { Arcball } from './util/arcball.js';
import { loadTexture } from './util/texture.js';
import { SquarePyramid } from './squarePyramid.js';
const canvas = document.getElementById('glCanvas');
const gl = canvas.getContext('webgl2');
let shader;
let isInitialized = false;
let viewMatrix = mat4.create();
let projMatrix = mat4.create();
let modelMatrix = mat4.create();
const axes = new Axes(gl, 1.5); // create an Axes object with the length of axis 1.5
const texture = loadTexture(gl, true, '../images/textures/sunrise.jpg'); // see ../util/texture.js
const pyramid = new SquarePyramid(gl);


// Arcball object
const arcball = new Arcball(canvas, 5.0, { rotation: 2.0, zoom: 0.0005 });

document.addEventListener('DOMContentLoaded', () => {
    if (isInitialized) {
        console.log("Already initialized");
        return;
    }

    main().then(success => {
        if (!success) {
            console.log('program terminated');
            return;
        }
        isInitialized = true;
    }).catch(error => {
        console.error('program terminated with error:', error);
    });
});

function initWebGL() {
    if (!gl) {
        console.error('WebGL 2 is not supported by your browser.');
        return false;
    }

    canvas.width = 700;
    canvas.height = 700;
    resizeAspectRatio(gl, canvas);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.1, 0.2, 0.3, 1.0);
    
    return true;
}

async function initShader() {
    const vertexShaderSource = await readShaderFile('shVert.glsl');
    const fragmentShaderSource = await readShaderFile('shFrag.glsl');
    shader = new Shader(gl, vertexShaderSource, fragmentShaderSource);
}

function render() {

    // clear canvas
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    // get view matrix from the arcball
    viewMatrix = arcball.getViewMatrix();

    // drawing the cube
    shader.use();  // using the cube's shader
    shader.setMat4('u_model', modelMatrix);
    shader.setMat4('u_view', viewMatrix);
    shader.setMat4('u_projection', projMatrix);
    pyramid.draw(shader);

    // drawing the axes (using the axes's shader: see util.js)
    axes.draw(viewMatrix, projMatrix);

    // call the render function the next time for animation
    requestAnimationFrame(render);
}

async function main() {
    try {
        if (!initWebGL()) {
            throw new Error('WebGL 초기화 실패');
        }
        
        await initShader();

        // View transformation matrix (the whole world is translated to -3 in z-direction)
        // Camera is at (0, 0, 0) and looking at negative z-direction
        mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(0, 0, -3));

        // Projection transformation matrix (invariant in the program)
        mat4.perspective(
            projMatrix,
            glMatrix.toRadian(60),  // field of view (fov, degree)
            canvas.width / canvas.height, // aspect ratio
            0.1, // near
            1000.0 // far
        );

        // activate the texture unit 0
        // in fact, we can omit this command
        // when we use the only one texture
        gl.activeTexture(gl.TEXTURE0);

        // bind the texture to the shader
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        

        // pass the u_texture uniform variable to the shader
        // with the texture unit number
        shader.setInt('u_texture', 0);

        // call the render function the first time for animation
        requestAnimationFrame(render);

        return true;

    } catch (error) {
        console.error('Failed to initialize program:', error);
        alert('Failed to initialize program');
        return false;
    }
}

