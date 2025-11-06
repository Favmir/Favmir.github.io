export class Cone {
    /**
     * @param {WebGLRenderingContext} gl         - WebGL 렌더링 컨텍스트
     * @param {number} segments                 - 옆면 세그먼트 수 (원 둘레를 몇 등분할지)
     * @param {object} options
     *        options.color : [r, g, b, a] 형태의 색상 (기본 [0.8, 0.8, 0.8, 1.0])
     */
    constructor(gl, segments = 32, options = {}) {
        this.gl = gl;

        // VAO, VBO, EBO 생성
        this.vao = gl.createVertexArray();
        this.vbo = gl.createBuffer();
        this.ebo = gl.createBuffer();

        // 파라미터 설정
        const radius = 0.5;     // 원뿔 밑면 반지름
        const halfH = 0.5;      // 높이의 절반 (y=-0.5 ~ y=0.5)
        this.segments = segments;

        // 세그먼트별 각도 간격
        const angleStep = (2 * Math.PI) / segments;

        // 정점/법선/색상/텍스처좌표/인덱스 데이터를 담을 임시 배열
        const positions = [];
        const normals   = [];
        const colors    = [];
        const texCoords = [];
        const indices   = [];

        // 옵션에서 color가 있으면 사용, 없으면 기본값 사용
        const defaultColor = [0.8, 0.8, 0.8, 1.0];
        const colorOption = options.color || defaultColor;

        // 콘의 상단 꼭지점은 (0, halfH, 0)에 위치
        const topX = 0.0;
        const topY = halfH;
        const topZ = 0.0;

        // 각 세그먼트별로 삼각형(face)을 만든다.
        // 삼각형 정점 순서(외부에서 본 CCW): top -> bot0 -> bot1
        //  - top: (0, +0.5, 0) 콘의 꼭지점
        //  - bot0: angle0, y= -0.5
        //  - bot1: angle1, y= -0.5
        for (let i = 0; i < segments; i++) {
            const angle0 = i * angleStep;
            const angle1 = (i + 1) * angleStep;

            // 현재 세그먼트의 하단 (y=-0.5)
            const x0_bot = radius * Math.cos(angle0);
            const z0_bot = radius * Math.sin(angle0);
            const x1_bot = radius * Math.cos(angle1);
            const z1_bot = radius * Math.sin(angle1);

            // 각 face의 3개 정점 (CCW)
            positions.push(
                // top
                topX, topY, topZ,
                // bot0
                x0_bot, -halfH, z0_bot,
                // bot1
                x1_bot, -halfH, z1_bot
            );

            // 면의 법선 계산 (두 벡터의 외적)
            // 벡터 v1 = bot0 - top
            const v1x = x0_bot - topX;
            const v1y = -halfH - topY;
            const v1z = z0_bot - topZ;
            
            // 벡터 v2 = bot1 - top
            const v2x = x1_bot - topX;
            const v2y = -halfH - topY;
            const v2z = z1_bot - topZ;
            
            // v2 x v1 (외적 방향 수정) - CCW 방향으로 수정
            let nx = v2y * v1z - v2z * v1y;
            let ny = v2z * v1x - v2x * v1z;
            let nz = v2x * v1y - v2y * v1x;
            
            // 법선 정규화
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 0) {
                nx /= len;
                ny /= len;
                nz /= len;
            }

            // 이 삼각형의 3개 정점에 동일한 법선 지정 (flat shading)
            for (let k = 0; k < 3; k++) {
                normals.push(nx, ny, nz);
            }

            // 색상도 마찬가지로 3정점 동일
            for (let k = 0; k < 3; k++) {
                colors.push(
                    colorOption[0],
                    colorOption[1],
                    colorOption[2],
                    colorOption[3]
                );
            }

            // 텍스처 좌표 (단순 conical mapping)
            // u: [0..1], v: y=+0.5 -> 1, y=-0.5 -> 0
            const u0 = i / segments;       // angle0 비율
            const u1 = (i + 1) / segments; // angle1 비율
            texCoords.push(
                // top
                (u0 + u1) / 2, 1,  // 꼭지점은 해당 세그먼트의 중간 u값, v=1
                // bot0
                u0, 0,
                // bot1
                u1, 0
            );

            // 인덱스 (한 삼각형)
            // 이번 face가 i번째면, 정점 baseIndex = i*3
            const base = i * 3;
            indices.push(
                base, base + 1, base + 2
            );
        }

        // Float32Array/Uint16Array에 담기
        this.vertices = new Float32Array(positions);
        this.normals  = new Float32Array(normals);
        this.colors   = new Float32Array(colors);
        this.texCoords= new Float32Array(texCoords);
        this.indices  = new Uint16Array(indices);

        // backup normals (for flat/smooth shading)
        this.faceNormals = new Float32Array(this.normals);
        this.vertexNormals = new Float32Array(this.normals);
        this.computeVertexNormals();

        // WebGL 버퍼 초기화
        this.initBuffers();
    }

    /**
     * Smooth Shading을 위해,
     * 각 정점별로 부드러운 법선 계산하여 this.vertexNormals에 저장.
     * 꼭지점에서는 원뿔의 축 방향(콘의 경사면 방향), 밑면 정점에서는 바깥쪽 방향으로 계산
     */
    computeVertexNormals() {
        const vCount = this.vertices.length / 3;
        // 새로 계산된 스무스 노말을 담을 버퍼 (vertices와 동일 크기)
        this.vertexNormals = new Float32Array(this.vertices.length);

        for (let i = 0; i < vCount; i++) {
            const x = this.vertices[i * 3 + 0];
            const y = this.vertices[i * 3 + 1];
            const z = this.vertices[i * 3 + 2];

            // 꼭지점인 경우 (y=0.5)
            if (Math.abs(y - 0.5) < 0.001) {
                // 원뿔 꼭지점의 스무스 노말은 모든 면의 법선 평균으로 계산
                // 원뿔 높이:반지름 = 1:0.5 비율일 때 약 33.7도 기울어짐
                // 노말 벡터: (0, cos(33.7°), 0) = (0, 0.83, 0) 정도
                this.vertexNormals[i * 3 + 0] = 0;
                this.vertexNormals[i * 3 + 1] = 0.83; // 위쪽 방향 (약간 경사진)
                this.vertexNormals[i * 3 + 2] = 0;
            } else {
                // 밑면 정점의 경우, 바깥쪽 방향 (x,z 평면상의 방향)
                let nx = x;
                let ny = 0; // 밑면의 법선은 y축 방향으로 0 (옆으로 향함)
                let nz = z;
                
                // 정규화
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (len > 0) {
                    this.vertexNormals[i * 3 + 0] = nx / len;
                    this.vertexNormals[i * 3 + 1] = ny / len;
                    this.vertexNormals[i * 3 + 2] = nz / len;
                } else {
                    // 혹시 모를 예외 상황
                    this.vertexNormals[i * 3 + 0] = 0;
                    this.vertexNormals[i * 3 + 1] = -1; // 아래쪽 방향
                    this.vertexNormals[i * 3 + 2] = 0;
                }
            }
        }
    }

    // faceNormals -> normals 복사
    copyFaceNormalsToNormals() {
        this.normals.set(this.faceNormals);
    }

    // vertexNormals -> normals 복사
    copyVertexNormalsToNormals() {
        this.normals.set(this.vertexNormals);
    }

    initBuffers() {
        const gl = this.gl;

        // 배열 크기 측정
        const vSize = this.vertices.byteLength;
        const nSize = this.normals.byteLength;
        const cSize = this.colors.byteLength;
        const tSize = this.texCoords.byteLength;
        const totalSize = vSize + nSize + cSize + tSize;

        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, totalSize, gl.STATIC_DRAW);

        // 순서대로 복사 (positions -> normals -> colors -> texCoords)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertices);
        gl.bufferSubData(gl.ARRAY_BUFFER, vSize, this.normals);
        gl.bufferSubData(gl.ARRAY_BUFFER, vSize + nSize, this.colors);
        gl.bufferSubData(gl.ARRAY_BUFFER, vSize + nSize + cSize, this.texCoords);

        // 인덱스 버퍼 (EBO)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW);

        // vertexAttribPointer 설정
        // (shader의 layout: 0->pos, 1->normal, 2->color, 3->texCoord)
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);  // positions
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, vSize); // normals
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, vSize + nSize); // colors
        gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, vSize + nSize + cSize); // texCoords

        gl.enableVertexAttribArray(0);
        gl.enableVertexAttribArray(1);
        gl.enableVertexAttribArray(2);
        gl.enableVertexAttribArray(3);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    /**
     * normals 배열 일부만 업데이트하고 싶을 때 (ex: Face/Vertex normal 토글 후)
     */
    updateNormals() {
        const gl = this.gl;
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

        const vSize = this.vertices.byteLength;
        // normals 부분만 다시 업로드
        gl.bufferSubData(gl.ARRAY_BUFFER, vSize, this.normals);

        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindVertexArray(null);
    }

    /**
     * 그리기
     * @param {Shader} shader - 사용할 셰이더
     */
    draw(shader) {
        const gl = this.gl;
        shader.use();
        gl.bindVertexArray(this.vao);
        gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
    }

    /**
     * 리소스 해제
     */
    delete() {
        const gl = this.gl;
        gl.deleteBuffer(this.vbo);
        gl.deleteBuffer(this.ebo);
        gl.deleteVertexArray(this.vao);
    }
}