import * as THREE from 'three';

export let starSphere, earthSphere, cloudSphere, atmosphereSphere, moonSphere, moonAtmosSphere;
export let atmosphereMat, moonAtmosMat;

export function initSpace(scene, loadTex) {
    const starTex = loadTex('assets/textures/stars.png');
    starTex.magFilter = THREE.NearestFilter;
    starTex.minFilter = THREE.NearestMipmapLinearFilter;
    starSphere = new THREE.Mesh(
        new THREE.SphereGeometry(750, 32, 32),
        new THREE.MeshBasicMaterial({ map: starTex, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, depthTest: true, fog: false })
    );
    starSphere.frustumCulled = false;
    starSphere.renderOrder = -2;
    scene.add(starSphere);

    const earthTex = loadTex('assets/textures/earth_surface.png');
    earthTex.wrapS = earthTex.wrapT = THREE.ClampToEdgeWrapping;
    earthTex.magFilter = THREE.NearestFilter;
    earthTex.minFilter = THREE.NearestMipmapLinearFilter;
    earthSphere = new THREE.Mesh(
        new THREE.SphereGeometry(2400, 64, 32),
        new THREE.MeshBasicMaterial({ map: earthTex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false })
    );
    earthSphere.rotation.x = Math.PI / 2;
    earthSphere.position.y = -2500;
    earthSphere.frustumCulled = false;
    earthSphere.renderOrder = -1;
    scene.add(earthSphere);

    const cloudsTex = loadTex('assets/textures/clouds.png');
    cloudsTex.wrapS = cloudsTex.wrapT = THREE.ClampToEdgeWrapping;
    cloudsTex.magFilter = THREE.NearestFilter;
    cloudsTex.minFilter = THREE.NearestMipmapLinearFilter;
    cloudSphere = new THREE.Mesh(
        new THREE.SphereGeometry(2402, 64, 32),
        new THREE.MeshBasicMaterial({ map: cloudsTex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false })
    );
    cloudSphere.rotation.x = Math.PI / 2;
    cloudSphere.position.y = -2500;
    cloudSphere.frustumCulled = false;
    cloudSphere.renderOrder = 0;
    scene.add(cloudSphere);

    atmosphereMat = new THREE.ShaderMaterial({
        uniforms: { opacity: { value: 0.0 } },
        vertexShader: /* glsl */`
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                vViewDir = normalize(-mvPos.xyz);
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: /* glsl */`
            uniform float opacity;
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                float rim = 1.0 - abs(dot(vNormal, vViewDir));
                float glow = pow(rim, 2.0) * (1.0 - pow(rim, 4.0));
                glow = min(glow * 2.2, 1.0);
                gl_FragColor = vec4(0.3, 0.6, 1.0, glow * opacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
        side: THREE.FrontSide,
    });
    atmosphereSphere = new THREE.Mesh(new THREE.SphereGeometry(2460, 64, 32), atmosphereMat);
    atmosphereSphere.rotation.x = Math.PI / 2;
    atmosphereSphere.position.y = -2500;
    atmosphereSphere.frustumCulled = false;
    atmosphereSphere.renderOrder = 1;
    scene.add(atmosphereSphere);

    const moonTex = loadTex('assets/prototype/moon/moon_surface.png');
    moonTex.wrapS = moonTex.wrapT = THREE.ClampToEdgeWrapping;
    moonTex.magFilter = THREE.NearestFilter;
    moonTex.minFilter = THREE.NearestMipmapLinearFilter;
    moonSphere = new THREE.Mesh(
        new THREE.SphereGeometry(600, 64, 32),
        new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false })
    );
    moonSphere.rotation.x = -Math.PI / 2;
    moonSphere.position.set(500, 3800, 20);
    moonSphere.frustumCulled = false;
    moonSphere.renderOrder = -1;
    scene.add(moonSphere);

    moonAtmosMat = new THREE.ShaderMaterial({
        uniforms: { opacity: { value: 0.0 } },
        vertexShader: /* glsl */`
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                vViewDir = normalize(-mvPos.xyz);
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: /* glsl */`
            uniform float opacity;
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                float rim = 1.0 - abs(dot(vNormal, vViewDir));
                float glow = pow(rim, 2.0) * (1.0 - pow(rim, 4.0));
                glow = min(glow * 2.2, 1.0);
                gl_FragColor = vec4(0.7, 0.75, 0.8, glow * opacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
        side: THREE.FrontSide,
    });
    moonAtmosSphere = new THREE.Mesh(new THREE.SphereGeometry(625, 64, 32), moonAtmosMat);
    moonAtmosSphere.rotation.x = -Math.PI / 2;
    moonAtmosSphere.position.set(500, 3800, 20);
    moonAtmosSphere.frustumCulled = false;
    moonAtmosSphere.renderOrder = 0;
    scene.add(moonAtmosSphere);
}
