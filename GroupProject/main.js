import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import RAPIER from "rapier";




const statsEl = document.getElementById("stats");

// ---------- Fixed timestep settings ----------
const FIXED_DT = 1 / 120;					// physics step (120 Hz)
const MAX_ACCUM = 0.25;						// clamp accumulator to avoid spiral of death

let accumulator = 0;
let lastTime = performance.now() / 1000;


const noFlipMirrors = 1;	// flipping viewports also turns faces inside out 

// --------------------------

await RAPIER.init();

const gravity = new RAPIER.Vector3(0, -9.81, 0);
const world = new RAPIER.World(gravity);

// ---------- THREE scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);


const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b0e14, 40, 220);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(8, 5, 10);
// --- Multi-viewport cameras ---
const camLeft = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
const camRight = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
const camBack = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
const camDriver = new THREE.PerspectiveCamera(75, 1, 0.05, 500);



const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.2, 0);

scene.add(new THREE.HemisphereLight(0xbfd7ff, 0x223344, 0.9));
const dir = new THREE.DirectionalLight(0xffffff, 1.1);
dir.position.set(10, 18, 8);
dir.castShadow = false;
scene.add(dir);


// ---------- Input ----------
const input = {
	throttle: 0, // 0..1
	brake: 0,		// 0..1
	steer: 0,		// -1..1
	handbrake: false,
	reset: false,
};

const keysDown = new Set();
const keysPressed = new Set();

window.addEventListener("keydown", (e) => {
  if (!keysDown.has(e.code)) keysPressed.add(e.code); // edge
  keysDown.add(e.code);
  if (e.code === "Space") e.preventDefault();
});
window.addEventListener("keyup", (e) => keysDown.delete(e.code));

function wasPressed(code) {
  return keysPressed.has(code);
}
function endFrameInput() {
  keysPressed.clear();
}

function sampleInput() {
	const w = keysDown.has("KeyW");
	const s = keysDown.has("KeyS");
	const a = keysDown.has("KeyA");
	const d = keysDown.has("KeyD");
	

	input.throttle = w ? 1 : 0;
	input.brake = s ? 1 : 0;
	input.steer = (a ? 1 : 0) + (d ? -1 : 0); // A=left(+), D=right(-)
	input.handbrake = keysDown.has("Space");
	input.reset = keysDown.has("KeyR");
	input.shiftUp = wasPressed("KeyE");
	input.shiftDown = wasPressed("KeyQ");

}


function addStaticTrimeshFromThreeMesh(mesh) {
  const geom = mesh.geometry.clone();
  geom.applyMatrix4(mesh.matrixWorld);

  const pos = geom.attributes.position.array; // Float32Array
  const idx = geom.index ? geom.index.array : null;

  const vertices = Float32Array.from(pos);
  const indices = idx ? Uint32Array.from(idx) : null;

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const colliderDesc = indices
    ? RAPIER.ColliderDesc.trimesh(vertices, indices)
    : RAPIER.ColliderDesc.trimesh(vertices, new Uint32Array([...Array(vertices.length/3).keys()]));

  world.createCollider(colliderDesc, body);
}


// ---------- Car physics model
class Wheel {
	constructor(opts) {
		this.name = opts.name;
		this.isDriven = !!opts.isDriven;
		this.isSteerable = !!opts.isSteerable;

		this.radius = opts.radius ?? 0.34;

		// state
		this.angularVel = 0;		 // rad/s
		this.steerAngle = 0;		 // rad
		this.normalLoad = 0;		 // N (computed)
	}

	update_tire(car, dt) {

		// Wheel local direction basis in world-space:
		// forward and right relative to car's yaw + steer.
		const yaw = car.yaw + this.steerAngle;
		const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // forward on XZ
		const right = new THREE.Vector3(fwd.z, 0, -fwd.x);

		// Velocity at contact patch (ignoring suspension and wheel offset for now)
		const v = car.vel.clone(); // world
		const vLong = v.dot(fwd);
		const vLat = v.dot(right);

		// Slip angle approximation
		const slipAngle = Math.atan2(vLat, Math.max(0.5, Math.abs(vLong)));

		// Lateral force: clamp
		const mu = car.tireMu;
		const FyMax = mu * this.normalLoad;
		const cornerStiffness = car.cornerStiffness; // N/rad-ish
		let Fy = -cornerStiffness * slipAngle;
		Fy = THREE.MathUtils.clamp(Fy, -FyMax, FyMax);

		// Rolling resistance along forward
		const Crr = car.rollingResistance;
		const Frr = -Crr * this.normalLoad * Math.sign(vLong);

		// Engine/brake torque produces longitudinal force (driven wheels only)
		let Fx = 0;
		if (this.isDriven) {
			// Convert wheel torque -> force (F = T / r), clamp by friction circle
			const driveForce = car.driveTorque / this.radius;
			Fx += driveForce;
		}

		// Brake/handbrake as opposing longitudinal force
		const brakeForce = (car.brakeForce * car.brakeInput + car.handbrakeForce * (car.handbrake ? 1 : 0));
		Fx += -brakeForce * Math.sign(vLong);

		// Friction circle clamp (very basic)
		const FxMax = mu * this.normalLoad;
		Fx = THREE.MathUtils.clamp(Fx, -FxMax, FxMax);

		// Apply forces to car body (sum)
		car.force.addScaledVector(fwd, Fx);
		car.force.addScaledVector(right, Fy);

		// Update wheel spin visually-ish
		// wheel angular acceleration from longitudinal speed (pure rolling)
		const targetAngVel = vLong / Math.max(1e-3, this.radius);
		this.angularVel = THREE.MathUtils.damp(this.angularVel, targetAngVel, 10, dt);
	}
}


class Car {
	constructor() {
		// Transform state (2D planar + yaw)
		this.pos = new THREE.Vector3(0, 0.0, 0);
		this.yaw = 0;

		this.vel = new THREE.Vector3(0, 0, 0); // world
		this.yawRate = 0;

		// Accumulators
		this.force = new THREE.Vector3(0, 0, 0);
		this.torqueYaw = 0;

		// Params (tweak freely)
		this.mass = 1200;							// kg
		this.invMass = 1 / this.mass;
		this.inertiaYaw = 1400;				// kg*m^2 (rough)
		this.invInertiaYaw = 1 / this.inertiaYaw;

		this.maxSteer = THREE.MathUtils.degToRad(28);
		this.steerSpeed = THREE.MathUtils.degToRad(220); // rad/s

		this.engineForce = 6500;			 // N (proxy)
		this.driveTorque = 0;					// N*m (computed)
		this.brakeForce = 9000;				// N
		this.handbrakeForce = 14000;	 // N

		this.tireMu = 1.05;
		this.cornerStiffness = 52000;	// N/rad
		this.rollingResistance = 0.015;

		this.linearDrag = 0.4;				 // velocity-proportional drag
		this.angularDrag = 2.0;

		// Inputs
		this.throttleInput = 0;
		this.brakeInput = 0;
		this.steerInput = 0;
		this.handbrake = false;

		// Wheels (front steer, rear drive) – can be remapped to your model
		this.wheels = [
			new Wheel({ name: "wheel_fl", isSteerable: true,  isDriven: false }),
			new Wheel({ name: "wheel_fr", isSteerable: true,  isDriven: false }),
			new Wheel({ name: "wheel_rl", isSteerable: false, isDriven: true }),
			new Wheel({ name: "wheel_rr", isSteerable: false, isDriven: true }),
		];

		// Simple weight distribution
		this.g = 9.81;
		this.weight = this.mass * this.g;

		// Visual
		this.root = new THREE.Group();
		scene.add(this.root);

		this.model = null;
        this.modelWheelNodess = new Map(); // wheelName -> { steer: Object3D, name: Object3D }

	}

	bindModel(gltfScene) {
		this.model = gltfScene;
		this.root.add(gltfScene);

		// Try to auto-find wheel objects by common names.
		// In Blender, name them exactly: wheel_fl, wheel_fr, wheel_rl, wheel_rr
		// wheel_fl_steer must be parent of wheel_fl to make wheels tilt
		for (const w of this.wheels) {
            const steer = gltfScene.getObjectByName(`${w.name}_steer`) ?? null;
			const wheel = gltfScene.getObjectByName(w.name) ?? null;
			this.modelWheelNodess.set(w.name, {steer, wheel});
		}
	}

	reset() {
		this.pos.set(0, 0, 0);
		this.yaw = 0;
		this.vel.set(0, 0, 0);
		this.yawRate = 0;
	}

	update_engine(dt) {
		// Map inputs -> “driveTorque” proxy
		// A more realistic engine model would include RPM, gears, etc.
		const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
		const vLong = this.vel.dot(forward);

		// Reduce engine force at high speed (simple top speed behavior)
		const speed = Math.abs(vLong);
		const speedLimiter = THREE.MathUtils.clamp(1.0 - speed / 55.0, 0.0, 1.0);

		const driveForce = this.engineForce * this.throttleInput * speedLimiter;

		// Convert force to torque at wheels (rough)
		// (If you later model drivetrain, put it here.)
		this.driveTorque = driveForce * 0.34; // N*m proxy
	}

	update_chassis(dt) {
		// Clear torque accumulator
		this.torqueYaw = 0;

		// Very basic yaw torque from lateral forces at front vs rear
		// This is a placeholder. Replace with force application at wheel contact points.
		// For now we approximate yaw response using steer + speed.
		const speed = this.vel.length();
		const steerEffect = this.steerInput;
		const desiredYawRate = steerEffect * speed * 0.18; // tweak
		this.yawRate = THREE.MathUtils.damp(this.yawRate, desiredYawRate, 6.5, dt);

		// Integrate yaw
		this.yaw += this.yawRate * dt;

		// Apply drag
		this.vel.addScaledVector(this.vel, -this.linearDrag * dt);
		this.yawRate *= Math.exp(-this.angularDrag * dt);

		// Integrate velocity from forces
		const accel = this.force.clone().multiplyScalar(this.invMass);
		this.vel.addScaledVector(accel, dt);

		// Integrate position
		this.pos.addScaledVector(this.vel, dt);

		// ground constraint
		this.pos.y = 0;
	}

	stepPhysics(dt) {
		// Inputs are sampled outside (once per render frame),
		this.force.set(0, 0, 0);

		// Steering toward target
		const targetSteer = this.maxSteer * this.steerInput;
		for (const w of this.wheels) {
			if (!w.isSteerable) continue;
			const delta = THREE.MathUtils.clamp(targetSteer - w.steerAngle, -this.steerSpeed * dt, this.steerSpeed * dt);
			w.steerAngle += delta;
		}

		// Compute per-wheel normal load (simple equal distribution)
		const perWheel = this.weight / this.wheels.length;
		for (const w of this.wheels) w.normalLoad = perWheel;

		// --- Your requested structure ---
		this.update_engine(dt);
		for (const w of this.wheels) w.update_tire(this, dt);
		this.update_chassis(dt);
	}
/*
	stepPhysics(dt) {
		// Input -> forces
		const throttle = input.throttle; // 0..1
		const brake = input.brake;       // 0..1
		const steer = input.steer;       // -1..1

		// Get car forward/right from rigidbody rotation
		const rot = carBody.rotation(); // quaternion
		const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

		const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
		const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);

		// Apply engine force
		const engine = 9000 * throttle;
		carBody.addForce({ x: forward.x * engine, y: 0, z: forward.z * engine }, true);

		// Apply brake as opposite force to current velocity
		if (brake > 0) {
			const v = carBody.linvel();
			carBody.addForce({ x: -v.x * 2000 * brake, y: 0, z: -v.z * 2000 * brake }, true);
		}

		// Steering as yaw torque (simple)
		const yawTorque = 2500 * steer * Math.max(2, carBody.linvel().z);
		carBody.addTorque({ x: 0, y: yawTorque, z: 0 }, true);

		// Step rapier (fixed)
		world.timestep = dt;
		world.step();
	}
*/

	syncVisual(alpha) {
		// alpha = interpolation factor (0..1) if you later keep previous state.
		// For now, we just directly sync to physics state.

		this.root.position.copy(this.pos);
		this.root.rotation.set(0, this.yaw, 0);

		// Animate wheel visuals if present
		for (const w of this.wheels) {
			const node = this.modelWheelNodess.get(w.name);
			if (!node) continue;

			if (w.isSteerable && node.steer) {
                node.steer.rotation.y = w.steerAngle;
            }
            if (node.wheel) {
                node.wheel.rotation.x += w.angularVel * FIXED_DT;
            }
        }
	}
}

const car = new Car();
const carBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,0,0));
world.createCollider(RAPIER.ColliderDesc.cuboid(2,1.5,4).setFriction(1.0));


// Fallback placeholder if model fails to load
function makePlaceholderCar() {
	const body = new THREE.Mesh(
		new THREE.BoxGeometry(1.8, 0.6, 4.0),
		new THREE.MeshStandardMaterial({ color: 0x2a66ff, metalness: 0.1, roughness: 0.6 })
	);
	body.position.y = 0.6;
	car.root.add(body);

	const cabin = new THREE.Mesh(
		new THREE.BoxGeometry(1.4, 0.5, 1.7),
		new THREE.MeshStandardMaterial({ color: 0x1a2a44, metalness: 0.0, roughness: 0.8 })
	);
	cabin.position.set(0, 1.0, -0.2);
	car.root.add(cabin);
}

// Load model (./assets/car.glb)
const loader = new GLTFLoader();
loader.load(
	"./assets/car.glb",
	(gltf) => {
		
		const model = gltf.scene;
		model.traverse((o) => {
			if (o.isMesh) {
				
				o.castShadow = false;
				o.receiveShadow = false;
			}
		});

		// model.rotation.y = Math.PI;

		car.bindModel(model);
	},
	undefined,
	(err) => {
		console.error("Failed to load ./assets/car.glb", err);
		makePlaceholderCar();
	}
);

loader.load(
	"./assets/DemoScene_City.glb",
	(gltf) => {
		const city = gltf.scene;
		city.traverse((o) => {
			if (o.isMesh){
				addStaticTrimeshFromThreeMesh(o);
				o.castShadow = false;
				o.receiveShadow = false;
			}
		});

		scene.add(city);
	},
	undefined,
	(err) => {
		console.error("Failed to load city", err);
		
		// Ground
		const geo = new THREE.PlaneGeometry(500, 500, 1, 1);
		geo.rotateX(-Math.PI / 2);
		const mat = new THREE.MeshStandardMaterial({ color: 0x907070, roughness: 1, metalness: 0 });
		const ground = new THREE.Mesh(geo, mat);
		ground.position.y = 0;
		scene.add(ground);

		// Simple grid helper
		const grid = new THREE.GridHelper(200, 100, 0x223044, 0x1a2433);
		grid.position.y = 0.001;
		scene.add(grid);
	}
)

// Camera follow (simple)
function updateCameraFollow(dt) {
	// A basic chase camera that eases behind the car
	const behindDist = 7;
	const height = 7;

	const forward = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
	const desiredPos = car.pos.clone()
		.addScaledVector(forward, -behindDist)
		.add(new THREE.Vector3(0, height, 0));

	camera.position.copy(desiredPos);
	controls.target.lerp(car.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 1 - Math.exp(-dt * 8));
	controls.update();
}

function updateViewCameras(dt) {
	// Car basis vectors in world space (XZ plane)
	const forward = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
	const right = new THREE.Vector3(forward.z, 0, -forward.x);
	const up = new THREE.Vector3(0,1,0);

	const targetBack = car.pos.clone()
	.add(new THREE.Vector3(0, 0.5, 0))          // height offset
	.addScaledVector(forward, -10);             // 30 units behind car



	// Distances/heights (tweak)
	
	const driverOffset =
		new THREE.Vector3(0.35, 1.35, -0.4)  // x, y, z in car-local-ish terms
			.addScaledVector(right, 0.0)
	;
	const sideDist = -1.1;
	const sideHeight = 1.2;
	const sideForward = 0.7;
	const sideTargetDist = 10;

	const backDist = 1.1;
	const backHeight = 1.5;

	// Left side view (camera sits to car's left, looking at car)
	{
		const desired = car.pos.clone()
			.addScaledVector(right, -sideDist)
			.addScaledVector(forward, sideForward)
			.add(new THREE.Vector3(0, sideHeight, 0));
		camLeft.position.copy(desired);
		camLeft.lookAt(targetBack.clone().addScaledVector(right,sideTargetDist));
	}

	// Right side view
	{
		const desired = car.pos.clone()
			.addScaledVector(right, sideDist)
			.addScaledVector(forward, sideForward)
			.add(new THREE.Vector3(0, sideHeight, 0));
		camRight.position.copy(desired);
		camRight.lookAt(targetBack.clone().addScaledVector(right,-sideTargetDist));
	}

	// Back view
	{
		const desired = car.pos.clone()
			.addScaledVector(forward, -backDist)
			.add(new THREE.Vector3(0, backHeight, 0));
		camBack.position.copy(desired);
		camBack.lookAt(targetBack);
	}

	// Driver view (positioned inside/near cabin, looking forward)
	{
		// Convert approximate local offset to world using forward/right (since we’re planar)
		const desired = car.pos.clone()
			.addScaledVector(right, driverOffset.x)
			.add(new THREE.Vector3(0, driverOffset.y, 0))
			.addScaledVector(forward, driverOffset.z);

		camDriver.position.lerp(desired, 1 - Math.exp(-dt * 50));

		const lookPoint = camDriver.position.clone()
		.addScaledVector(forward, 10)
		.addScaledVector(right,-1.5)
		.add(new THREE.Vector3(0, 0.1, 0));
		camDriver.lookAt(lookPoint);
	}
}


function physicsStepFixed(dt) {
	car.stepPhysics(dt);
}

function renderViewports() {
	const width = window.innerWidth;
	const height = window.innerHeight;

	renderer.setScissorTest(true);

	// Define 2x2 tiles
	const sideWidth = Math.floor(width / 4);
	const sideHeight = Math.floor(height / 5);

	// Utility: render one viewport
	function draw(cam, x, y, vw, vh) {
		cam.aspect = vw / vh;
		cam.updateProjectionMatrix();

		if (cam === camLeft || cam === camRight || cam === camBack){
			const flippedMatrix = cam.projectionMatrix.clone();
			flippedMatrix.elements[noFlipMirrors] *= -1;
			cam.projectionMatrix.copy(flippedMatrix);
		}
		renderer.setViewport(x, y, vw, vh);
		renderer.setScissor(x, y, vw, vh);
		renderer.render(scene, cam);
	
	}

	// Note: WebGL viewport origin is bottom-left.
	draw(camLeft,   0, height-sideHeight, sideWidth, sideHeight);
	draw(camBack,   sideWidth, height-sideHeight, 2*sideWidth, sideHeight); 
	draw(camDriver, 0, 0, width, height - sideHeight);
	draw(camRight,  width-sideWidth, height-sideHeight, sideWidth, sideHeight);

	renderer.setScissorTest(false);
}


function renderLoop() {
	const now = performance.now() / 1000;
	let frameDt = now - lastTime;
	lastTime = now;

	// Avoid huge jumps (tab switching etc.)
	frameDt = Math.min(frameDt, 0.1);

	sampleInput();

	// Apply sampled inputs to car “control state”
	car.throttleInput = input.throttle;
	car.brakeInput = input.brake;
	car.steerInput = input.steer;
	car.handbrake = input.handbrake;

	if (input.reset) car.reset();

	accumulator += frameDt;
	accumulator = Math.min(accumulator, MAX_ACCUM);

	let steps = 0;
	while (accumulator >= FIXED_DT) {
		physicsStepFixed(FIXED_DT);
		accumulator -= FIXED_DT;
		steps++;
		if (steps > 10) break; // safety; should be rare due to MAX_ACCUM
	}
	endFrameInput();


	// Visual sync (no interpolation yet; add it later if you keep previous state)
	car.syncVisual(accumulator / FIXED_DT);
	updateCameraFollow(frameDt);

	updateViewCameras(frameDt);
	renderViewports();


	// HUD
	statsEl.textContent =
		`FPS dt: ${(frameDt * 1000).toFixed(2)}ms | physics: ${FIXED_DT * 1000}ms step\n` +
		`speed: ${car.vel.length().toFixed(2)} m/s | yaw: ${(THREE.MathUtils.radToDeg(car.yaw) % 360).toFixed(1)}°`;
    
	requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

window.addEventListener("resize", () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});
