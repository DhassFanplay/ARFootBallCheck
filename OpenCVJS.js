let detector = null;
let selectedDeviceId = null;
let unityInstance = null;
let video = null;
let canvas = null;
let ctx = null;
let firstFrameSent = false;

// Step 1: Send available cameras to Unity
async function listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.error("MediaDevices API not supported.");
        return;
    }

    try {
        await navigator.mediaDevices.getUserMedia({ video: true }); // ask permission
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(d => d.kind === 'videoinput');

        const options = videoInputs.map(d => ({
            label: d.label || `Camera ${d.deviceId?.substring(0, 4)}`,
            deviceId: d.deviceId || ""
        }));

        console.log("Available cameras:", options);

        if (unityInstance) {
            unityInstance.SendMessage('CameraManager', 'OnReceiveCameraList', JSON.stringify(options));
        }
    } catch (err) {
        console.error("Error requesting camera access or listing devices:", err);
    }
}

// Step 2: Called by Unity to start tracking
async function StartPoseTracking(deviceId) {
    console.log("Starting pose tracking on device:", deviceId);
    selectedDeviceId = deviceId;
    firstFrameSent = false; // reset loading trigger

    await setupCamera(deviceId);
    if (!detector) {
        await loadDetector();
    }
    detectPose();
}

// Step 3: Setup camera video stream
async function setupCamera(deviceId) {
    try {
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }

        if (!video) {
            video = document.createElement("video");
            video.setAttribute("autoplay", "");
            video.setAttribute("playsinline", "");
            video.style.position = "absolute";
            video.style.top = "10px";
            video.style.left = "10px";
            video.style.width = "320px";
            video.style.height = "240px";
            video.style.zIndex = "1000";
            video.style.border = "2px solid red";
            video.style.display = "none";
            document.body.appendChild(video);
        }

        const constraints = {
            video: {
                deviceId: { exact: deviceId }
            },
            audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;

        await new Promise(resolve => {
            video.onloadedmetadata = () => {
                video.play().then(() => {
                    console.log("Video is playing");
                    resolve();
                }).catch(e => {
                    console.error("Video play failed:", e);
                    resolve();
                });
            };
        });

        if (!canvas) {
            canvas = document.createElement("canvas");
            canvas.style.position = "absolute";
            canvas.style.top = "260px";
            canvas.style.left = "10px";
            canvas.style.width = "640px";
            canvas.style.height = "480px";
            canvas.style.zIndex = "1000";
            canvas.style.border = "2px solid green";
            canvas.style.display = "none";
            document.body.appendChild(canvas);
            ctx = canvas.getContext("2d");
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

    } catch (error) {
        console.error("Error setting up camera:", error);
    }
}

// Step 4: Load MoveNet pose detector
async function loadDetector() {
    try {
        await tf.setBackend("webgl");
        await tf.ready();

        detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
            modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
            enableSmoothing: true,
        });

        console.log("MoveNet detector loaded");
    } catch (error) {
        console.error("Error loading pose detector:", error);
    }
}

// Step 5: Real-time pose detection loop
async function detectPose() {
    if (!detector || !video || video.readyState < 2) {
        requestAnimationFrame(detectPose);
        return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL("image/jpeg");

    if (unityInstance) {
        unityInstance.SendMessage("CameraManager", "OnReceiveVideoFrame", base64);

        // One-time event to tell Unity the first frame is ready
        if (!firstFrameSent) {
            unityInstance.SendMessage("CameraManager", "OnCameraReady");
            firstFrameSent = true;
        }
    }

    try {
        const poses = await detector.estimatePoses(canvas);
        if (poses.length > 0) {
            const keypoints = poses[0].keypoints;
            const leftAnkle = keypoints[15];
            const rightAnkle = keypoints[16];

            const foot = (leftAnkle?.score ?? 0) > (rightAnkle?.score ?? 0) ? leftAnkle : rightAnkle;

            if (foot && foot.score > 0.3) {
                const normalized = {
                    x: foot.x / canvas.width,
                    y: foot.y / canvas.height
                };
                if (unityInstance) {
                    unityInstance.SendMessage("FootCube", "OnReceiveFootPosition", JSON.stringify(normalized));
                }
            }
        }
    } catch (err) {
        console.error("Pose detection error:", err);
    }

    requestAnimationFrame(detectPose);
}

// Unity registration
function RegisterUnityInstance(instance) {
    unityInstance = instance;
    listCameras();
}

// Expose to global
window.RegisterUnityInstance = RegisterUnityInstance;
window.StartPoseTracking = StartPoseTracking;
