
const canvas = document.getElementById('glCanvas'); // Get the canvas element 
const gl = canvas.getContext('webgl2'); // Get the WebGL2 context

if (!gl) {
    console.error('WebGL 2 is not supported by your browser.');
}

canvas.width = 500;
canvas.height = 500;

gl.viewport(0, 0, canvas.width, canvas.height);
gl.clearColor(1, 1, 1, 1);


render();

function render() {
    gl.clear(gl.COLOR_BUFFER_BIT);
	gl.enable(gl.SCISSOR_TEST);
    // Draw something here

	gl.scissor(0, 0, canvas.width/2, canvas.height/2);
	gl.clearColor(0, 0, 1, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.scissor(canvas.width/2, 0, canvas.width/2, canvas.height/2);
	gl.clearColor(1, 1, 0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.scissor(0, canvas.height/2, canvas.width/2, canvas.height/2);
	gl.clearColor(0, 1, 0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.scissor(canvas.width/2, canvas.height/2, canvas.width/2, canvas.height/2);
	gl.clearColor(1, 0, 0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.disable(gl.SCISSOR_TEST);
}

window.addEventListener('resize', () => {
    canvas.width = canvas.height = Math.min(window.innerWidth,window.innerHeight);
	gl.viewport(0,0,canvas.width,canvas.height);
    render();
});

