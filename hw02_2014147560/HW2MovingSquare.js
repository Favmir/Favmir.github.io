import { resizeAspectRatio, setupText} from '../util.js';
import { Shader, readShaderFile } from '../shader.js';

const canvas = document.getElementById('glCanvas');
const gl = canvas.getContext('webgl2');
let shader;   // shader program
let vao;      // vertex array object
let boxTranslation = [0.0, 0.0, 0.0]; // location of box
// const width = 0.2; // width of box
// const height = 0.2; // height of box
let input = new Set(); // set of key inputs
let lastPressedX; // 마지막으로 입력한 x축 방향키
let lastPressedY; // 마지막으로 입력한 y축 방향키



function initWebGL() {
    if (!gl) {
        console.error('WebGL 2 is not supported by your browser.');
        return false;
    }

    canvas.width = 600;
    canvas.height = 600;

    resizeAspectRatio(gl, canvas);

    // Initialize WebGL settings
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    
    return true;
}

async function initShader() {
    const vertexShaderSource = await readShaderFile('shVert.glsl');
    const fragmentShaderSource = await readShaderFile('shFrag.glsl');
    shader = new Shader(gl, vertexShaderSource, fragmentShaderSource);
}

/*
조작감이 좋은 Null movement canceling을 위해 키보드 이벤트가 복잡하게 설정되어 있습니다.
← 를 누르면서 → 키를 누르면 나중에 입력한 → 방향키가 우선순위가 되어 오른쪽으로 이동합니다.
이 상태에서 → 키를 떼면 다시 ← 방향키가 우선순위가 되어 왼쪽으로 이동합니다.
*/
function setupKeyboardEvents() {
    document.addEventListener('keydown', (event) => {
        // console.log(`Key pressed: ${event.key}`);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp'){
            lastPressedY = event.key;
            input.add(event.key);
            console.log(`${event.key} directional input started`);
        }else if( event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            lastPressedX = event.key;
            input.add(event.key);
            console.log(`${event.key} directional input started`);
        }
    });
    document.addEventListener('keyup', (event) => {
        if (event.key === 'ArrowDown') {
            if(input.has('ArrowUp')) lastPressedY = 'ArrowUp';
            input.delete(event.key);
            console.log(`${event.key} directional input stopped`);
        }
        else if (event.key === 'ArrowUp') {
            if(input.has('ArrowDown')) lastPressedY = 'ArrowDown';
            input.delete(event.key);
            console.log(`${event.key} directional input stopped`);
        }
        else if (event.key === 'ArrowLeft') {
            if(input.has('ArrowRight')) lastPressedX = 'ArrowRight';
            input.delete(event.key);
            console.log(`${event.key} directional input stopped`);
        }
        else if (event.key === 'ArrowRight') {
            if(input.has('ArrowLeft')) lastPressedX = 'ArrowLeft';
            input.delete(event.key);
            console.log(`${event.key} directional input stopped`);
        }
        // console.log(`Key released: ${event.key}`);
    });
}

function setupBuffers() {
    const vertices = new Float32Array([
        -0.1, -0.1, 0.0,  // Bottom left
         0.1, -0.1, 0.0,  // Bottom right
         0.1,  0.1, 0.0,  // Top right
        -0.1,  0.1, 0.0   // Top left
    ]);

    // Indices for FILL mode (triangles)
    const fillIndices = new Uint16Array([
        0, 1, 2,  // First triangle
        2, 3, 0   // Second triangle
    ]);
    
    // Create Vertex Array Object
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // Create vertex buffer
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    // Link vertex data
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    // Create element buffer for FILL
    const fillIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fillIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, fillIndices, gl.STATIC_DRAW);

    shader.setAttribPointer('aPos', 3, gl.FLOAT, false, 0, 0);

}

function render() {
    if (input.has('ArrowUp') && lastPressedY !== 'ArrowDown' && boxTranslation[1] < 0.9) {
        boxTranslation[1] += 0.01;
    }
    if (input.has('ArrowDown') && lastPressedY !== 'ArrowUp' && boxTranslation[1] > -0.9) {
        boxTranslation[1] -= 0.01;
    }
    if (input.has('ArrowLeft') && lastPressedX !== 'ArrowRight' && boxTranslation[0] > -0.9) {
        boxTranslation[0] -= 0.01;
    }
    if (input.has('ArrowRight') && lastPressedX !== 'ArrowLeft' && boxTranslation[0] < 0.9) {
        boxTranslation[0] += 0.01;
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(vao);

    //set translation uniform in vertex shaderk
    shader.setVec3('translation', boxTranslation);

    // draw rectangles using TRIANGLE_FAN, without using index
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    requestAnimationFrame(() => render());
}

async function main() {
    try {

        // WebGL 초기화
        if (!initWebGL()) {
            throw new Error('WebGL 초기화 실패');
        }

        // 셰이더 초기화
        await initShader();

        // setup text overlay (see util.js)
        setupText(canvas, "Use arrow keys to move the rectangle", 1);

        // 키보드 이벤트 설정
        setupKeyboardEvents();
        
        // 나머지 초기화
        setupBuffers(shader);
        shader.use();
        
        // 렌더링 시작
        render();

        return true;

    } catch (error) {
        console.error('Failed to initialize program:', error);
        alert('프로그램 초기화에 실패했습니다.');
        return false;
    }
}

// call main function
main().then(success => {
    if (!success) {
        console.log('프로그램을 종료합니다.');
        return;
    }
}).catch(error => {
    console.error('프로그램 실행 중 오류 발생:', error);
});