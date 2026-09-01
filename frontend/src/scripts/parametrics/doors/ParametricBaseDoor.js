import Enum from "es6-enum";
import { BufferGeometry, BufferAttribute, Matrix4, Vector3, Face3, Geometry, DoubleSide, Color } from "three";
import { MeshStandardMaterial, EventDispatcher, TextureLoader, RepeatWrapping } from "three";
import { EVENT_PARAMETRIC_GEOMETRY_UPATED } from "../../core/events";
import { DoorHandleGenerator } from "./doorhandles/DoorHandleGenerator";


export const DOOR_OPEN_DIRECTIONS = Enum('RIGHT', 'LEFT', 'BOTH_SIDES', 'NO_DOORS');
export const DOOR_HANDLE_TYPES = Enum('None', 'HANDLE_01', 'HANDLE_02', 'HANDLE_03', 'HANDLE_04');

/**
 * ParametricBaseDoor is the implementation of Model 01 from Archimesh
 */
export class ParametricBaseDoor extends EventDispatcher {
    constructor(parameters) {
        super();
        // DARK default to MATCH THE WINDOW: black frame (#1A1A1A) + dark panel
        // (#3D3D3D) + clear glass (#DCE6EC) — same look as ParametricBaseWindow.
        let opts = { frameSize: 5, frameColor: '#1A1A1A', doorColor: '#3D3D3D', frameWidth: 100, frameHeight: 200, frameThickness: 20, doorRatio: 0.5, openDirection: DOOR_OPEN_DIRECTIONS.RIGHT.description, handleType: DOOR_HANDLE_TYPES.HANDLE_01.description, doorHandleColor: '#F0F0F0', glassColor: '#DCE6EC' };
        for (var opt in opts) {
            if (opt === 'frameColor' || opt === 'doorColor' || opt === 'doorHandleColor' || opt === 'glassColor') {
                opts[opt] = new Color(parameters[opt]);
            } else if (opts.hasOwnProperty(opt) && parameters.hasOwnProperty(opt)) {
                opts[opt] = parameters[opt];
            }
        }
        // Migrate any old/light/wood door colour to the WINDOW's dark look, so a
        // saved white or wood door renders black-framed + charcoal like the
        // window. Genuinely custom colours a user picked are left as-is.
        const DARK_FRAME = '#1A1A1A';
        const DARK_DOOR = '#3D3D3D';
        const __oldToNew = { ff0000: DARK_FRAME, '6e5330': DARK_FRAME, 'a9855c': DARK_DOOR, e0e0ee: DARK_DOOR, eaeaea: DARK_DOOR, dadada: DARK_DOOR, '8e8a85': DARK_DOOR, e7e7e7: DARK_DOOR, '87ceeb': '#DCE6EC' };
        // Light frame/panel values (incl. the window's migrated greys) → dark.
        const __whiteish = ['ffffff', 'fefefe', 'f5f5f5', 'e0e0e0', 'fafafa', 'e7e7e7', 'd9d9d9', '9a9a9a', '3a3a3a', 'f0f0f0'];
        ['frameColor', 'doorColor', 'glassColor'].forEach((k) => {
            const c = opts[k];
            if (c && c.getHexString) {
                const hx = c.getHexString().toLowerCase();
                if (__oldToNew[hx]) opts[k] = new Color(__oldToNew[hx]);
                if (k === 'doorColor' && __whiteish.indexOf(hx) !== -1) {
                    opts[k] = new Color(DARK_DOOR);
                }
                if (k === 'frameColor' && __whiteish.indexOf(hx) !== -1) {
                    opts[k] = new Color(DARK_FRAME);
                }
            }
        });
        opts = this.__validateParameters(opts);
        this.__doorType = 1;
        this.__name = 'Door';

        this.__frameSize = opts.frameSize; //This value will be set in validatePArameters
        this.__frameWidth = opts.frameWidth;
        this.__frameHeight = opts.frameHeight;
        this.__frameThickness = opts.frameThickness;
        this.__doorRatio = opts.doorRatio;


        this.__openDirection = null;
        this.__handleType = null;
        switch (opts.openDirection) {
            case DOOR_OPEN_DIRECTIONS.RIGHT.description:
                this.__openDirection = DOOR_OPEN_DIRECTIONS.RIGHT; //This value will be set in validatePArameters
                break;
            case DOOR_OPEN_DIRECTIONS.LEFT.description:
                this.__openDirection = DOOR_OPEN_DIRECTIONS.LEFT; //This value will be set in validatePArameters
                break;
            case DOOR_OPEN_DIRECTIONS.BOTH_SIDES.description:
                this.__openDirection = DOOR_OPEN_DIRECTIONS.BOTH_SIDES; //This value will be set in validatePArameters
                break;
            case DOOR_OPEN_DIRECTIONS.NO_DOORS.description:
                this.__openDirection = DOOR_OPEN_DIRECTIONS.NO_DOORS; //This value will be set in validatePArameters
                break;
        }

        switch (opts.handleType) {
            case DOOR_HANDLE_TYPES.None.description:
                this.__handleType = DOOR_HANDLE_TYPES.None; //This value will be set in validatePArameters
                break;
            case DOOR_HANDLE_TYPES.HANDLE_01.description:
                this.__handleType = DOOR_HANDLE_TYPES.HANDLE_01; //This value will be set in validatePArameters
                break;
            case DOOR_HANDLE_TYPES.HANDLE_02.description:
                this.__handleType = DOOR_HANDLE_TYPES.HANDLE_02; //This value will be set in validatePArameters
                break;
            case DOOR_HANDLE_TYPES.HANDLE_03.description:
                this.__handleType = DOOR_HANDLE_TYPES.HANDLE_03; //This value will be set in validatePArameters
                break;
            case DOOR_HANDLE_TYPES.HANDLE_04.description:
                this.__handleType = DOOR_HANDLE_TYPES.HANDLE_04; //This value will be set in validatePArameters
                break;
        }
        this.__frameMaterial = new MeshStandardMaterial({ color: opts.frameColor, side: DoubleSide });
        this.__doorMaterial = new MeshStandardMaterial({ color: opts.doorColor, side: DoubleSide, wireframe: false });
        // Door DEFAULTS to black frame + charcoal panel (via the colour
        // migration above), but stays fully changeable from the Door Properties
        // panel — no forced override here, so picking a colour/finish applies
        // normally (same logic as walls and windows).
        this.__handleMaterial = new MeshStandardMaterial({ color: '#F0F0FF', side: DoubleSide, wireframe: false });
        this.__rightDoorMaterial = this.__doorMaterial; //new MeshStandardMaterial({ color: '#FF0000', wireframe: false }); //Right is red color
        this.__leftDoorMaterial = this.__doorMaterial; //new MeshStandardMaterial({ color: '#0000FF', wireframe: false }); //Left is blue color
        this.__doorHandleMaterial = new MeshStandardMaterial({ color: opts.doorHandleColor, wireframe: false, roughness: 0.0, metalness: 0.0 });
        this.__glassMaterial = new MeshStandardMaterial({ color: opts.glassColor, side: DoubleSide, wireframe: false, transparent: true, opacity: 0.6 });
        this.__doorFrameMaterialId = 0;
        this.__doorMaterialId = 1;
        this.__leftDoorMaterialId = 2;
        this.__rightDoorMaterialId = 3;
        this.__doorHandleMaterialId = 4;
        this.__glassMaterialId = 5;
        this.__material = [
            this.__frameMaterial,
            this.__doorMaterial,
            this.__leftDoorMaterial,
            this.__rightDoorMaterial,
            this.__doorHandleMaterial,
            this.__glassMaterial
        ];
        this.__doorMaterial.normalScale.set(100, 100, 100);
        this.__geometry = this.__proceedure();

        // Remember chosen finish textures so they can be SAVED (via metadata)
        // and re-applied on reload — otherwise a picked finish is lost on refresh.
        this.__surfaceMaps = {};
        const __p = parameters || {};
        if (__p.frameMap) this.setSurfaceMap('frame', __p.frameMap);
        if (__p.doorMap) this.setSurfaceMap('door', __p.doorMap);
        if (__p.handleMap) this.setSurfaceMap('handle', __p.handleMap);
        if (__p.glassMap) this.setSurfaceMap('glass', __p.glassMap);
    }

    __convertFrom4ToFace3(facegroups, materialId = 0) {
        let faces = [];
        for (let i = 0; i < facegroups.length; i += 4) {
            let f1 = new Face3(facegroups[i], facegroups[i + 1], facegroups[i + 2]);
            let f2 = new Face3(facegroups[i], facegroups[i + 2], facegroups[i + 3]);
            f1.materialIndex = materialId;
            f2.materialIndex = materialId;
            faces.push(f1);
            faces.push(f2);
        }
        return faces;
    }

    __validateParameters(parameters) {
        parameters.frameSize = Math.max(5, Math.min(25, parameters.frameSize)); //Expressed in centimeters
        parameters.doorRatio = Math.max(0.0, Math.min(1.0, parameters.doorRatio)); //Expressed in centimeters
        let doorOpenParameter = parameters.openDirection;
        switch (doorOpenParameter) {
            case DOOR_OPEN_DIRECTIONS.RIGHT.description:
            case DOOR_OPEN_DIRECTIONS.LEFT.description:
            case DOOR_OPEN_DIRECTIONS.BOTH_SIDES.description:
            case DOOR_OPEN_DIRECTIONS.NO_DOORS.description:
                break;
            default:
                throw new Error('Unindentifiable door type');
        }
        return parameters;
    }

    __updateGeometry() {
        let updatedGeometry = this.__proceedure();
        this.__geometry.dispose();
        this.__geometry = updatedGeometry;

        this.dispatchEvent({ type: EVENT_PARAMETRIC_GEOMETRY_UPATED, target: this });
    }

    __proceedure() {
        let returnGeometry = null;
        let doorGeometry = new Geometry();
        let doorFrameGeometry = this.__shapeMesh();
        let doorsToGenerate = this.__shapeChildren();
        if (doorFrameGeometry) {
            doorGeometry.merge(doorFrameGeometry);
        }
        if (doorsToGenerate.right) {
            doorGeometry.merge(doorsToGenerate.right);
        }
        if (doorsToGenerate.left) {
            doorGeometry.merge(doorsToGenerate.left);
        }

        doorGeometry.computeVertexNormals();
        doorGeometry.computeFaceNormals();
        doorGeometry.computeBoundingBox();

        returnGeometry = new BufferGeometry().fromGeometry(doorGeometry);
        returnGeometry.normalizeNormals();
        // The door is built from raw faces with no texture coordinates, so a
        // finishing/texture map would have nowhere to map and be ignored. Add a
        // planar (X = width, Y = height) UV map so a chosen finish paints onto
        // the door face. (The door face lies in the XY plane after the frame's
        // -90° X rotation.)
        this.__applyPlanarUVs(returnGeometry);
        return returnGeometry;
    }

    // Planar XY UV projection across the door's bounding box.
    __applyPlanarUVs(geometry) {
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox;
        const pos = geometry.attributes.position;
        if (!bb || !pos) return;
        const sizeX = bb.max.x - bb.min.x || 1;
        const sizeY = bb.max.y - bb.min.y || 1;
        const uvs = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
            uvs[i * 2] = (pos.getX(i) - bb.min.x) / sizeX;
            uvs[i * 2 + 1] = (pos.getY(i) - bb.min.y) / sizeY;
        }
        geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    }

    __shapeMesh() {
        let doorFrameGeometry = this.__createDoorFrame();
        return doorFrameGeometry;
    }

    __createDoorFrame() {
        let tf = this.__frameThickness / 3.0;
        let sf = this.__frameSize;
        let wf = (this.__frameWidth * 0.5) - sf;
        let hf = this.__frameHeight - sf;
        let gap = 0.02;
        let deep = this.__frameThickness * 0.50;

        let verts = [
            new Vector3(-wf - sf, -tf, 0),
            new Vector3(-wf - sf, tf * 2, 0),
            new Vector3(-wf, tf * 2, 0),
            new Vector3(-wf - sf, -tf, hf + sf),
            new Vector3(-wf - sf, tf * 2, hf + sf),
            new Vector3(wf + sf, tf * 2, hf + sf),
            new Vector3(wf + sf, -tf, hf + sf),
            new Vector3(wf, -tf, hf),
            new Vector3(-wf, tf * 2, hf),
            new Vector3(wf, -tf, 0),
            new Vector3(wf + sf, -tf, 0),
            new Vector3(wf + sf, tf * 2, 0),
            new Vector3(wf, -tf + deep, hf),
            new Vector3(-wf, -tf + deep, hf),
            new Vector3(-wf, -tf + deep, 0),
            new Vector3(-wf + gap, -tf + deep, hf),
            new Vector3(-wf + gap, -tf + deep, 0),
            new Vector3(-wf + gap, tf * 2, hf),
            new Vector3(-wf + gap, tf * 2, 0),
            new Vector3(wf, -tf + deep, 0),
            new Vector3(-wf, -tf, hf),
            new Vector3(-wf, -tf, 0),
            new Vector3(wf, tf * 2, hf),
            new Vector3(wf, tf * 2, 0),
            new Vector3(wf - gap, tf * 2, 0),
            new Vector3(wf - gap, -tf + deep, 0),
            new Vector3(wf - gap, tf * 2, hf),
            new Vector3(wf - gap, -tf + deep, hf - gap),
            new Vector3(wf - gap, -tf + deep, hf),
            new Vector3(-wf + gap, tf * 2, hf - gap),
            new Vector3(-wf + gap, -tf + deep, hf - gap),
            new Vector3(wf - gap, tf * 2, hf - gap)
        ];
        let geometry = new Geometry();
        let faceIds = [3, 4, 1, 0, 7, 12, 19, 9, 4, 3, 6, 5, 10, 11, 5, 6, 13, 20, 21, 14, 17, 15, 16, 18, 11, 23, 22, 5, 20, 13, 12, 7, 20, 3, 0, 21, 9, 10, 6, 7, 13, 14, 16, 15, 4, 8, 2, 1, 29, 30, 27, 31, 7, 6, 3, 20, 8, 4, 5, 22, 14, 2, 18, 16, 17, 18, 2, 8, 28, 25, 19, 12, 28, 26, 24, 25, 25, 24, 23, 19, 22, 23, 24, 26, 29, 31, 26, 17, 15, 28, 27, 30];
        let faces = this.__convertFrom4ToFace3(faceIds, 0);
        let extraFace = new Face3(8, 22, 26);
        extraFace.materialIndex = 0;
        faces.push(extraFace);
        geometry.vertices = verts;
        geometry.faces = faces;
        geometry.elementsNeedUpdate = true;
        geometry.applyMatrix4(new Matrix4().makeRotationAxis(new Vector3(1, 0, 0), -Math.PI * 0.5));
        geometry.applyMatrix4(new Matrix4().makeTranslation(0, -this.__frameHeight * 0.5, 0));
        geometry.computeVertexNormals();
        geometry.computeFaceNormals();
        geometry.computeBoundingBox();
        return geometry; //new BufferGeometry().fromGeometry(geometry);
    }

    __shapeChildren() {
        let doorRight = null,
            doorLeft = null;
        let w = this.__frameWidth;
        let w1 = (w * this.__doorRatio);
        let w2 = (w - w1);
        switch (this.__openDirection) {
            case DOOR_OPEN_DIRECTIONS.NO_DOORS:
                break;
            case DOOR_OPEN_DIRECTIONS.LEFT:
                //Get the buffergeometry of only one door
                doorLeft = this.__makeOneDoor(w, this.__openDirection, this.__leftDoorMaterialId, 'Left');
                doorLeft.applyMatrix4(new Matrix4().makeTranslation(-(this.__frameWidth * 0.5) + this.__frameSize, 0, 0));
                break;
            case DOOR_OPEN_DIRECTIONS.RIGHT:
                //Get the buffergeometry of only one door
                doorRight = this.__makeOneDoor(w, this.__openDirection, this.__rightDoorMaterialId, 'Right');
                doorRight.applyMatrix4(new Matrix4().makeTranslation((this.__frameWidth * 0.5) - this.__frameSize, 0, 0));
                break;
            case DOOR_OPEN_DIRECTIONS.BOTH_SIDES:
                //Get the buffergeometry of left door
                doorLeft = this.__makeOneDoor(w1 + this.__frameSize, DOOR_OPEN_DIRECTIONS.LEFT, this.__leftDoorMaterialId, 'Left');
                doorLeft.applyMatrix4(new Matrix4().makeTranslation(-(this.__frameWidth * 0.5) + this.__frameSize, 0, 0));
                //Get the buffergeometry of right door
                doorRight = this.__makeOneDoor(w2 + this.__frameSize, DOOR_OPEN_DIRECTIONS.RIGHT, this.__rightDoorMaterialId, 'Right');
                doorRight.applyMatrix4(new Matrix4().makeTranslation((this.__frameWidth * 0.5) - this.__frameSize, 0, 0));
                break;
            default:
                throw new Error(`Unindentifiable door type ${this.__openDirection}`);
        }
        return { right: doorRight, left: doorLeft };
    }

    __makeOneDoor(frameWidth, openingDirection, materialId = 1, doorSide = 'Right') {
        let aDoorGeometry = this.__createDoorData(frameWidth, openingDirection, materialId);

        if (this.__handleType !== DOOR_HANDLE_TYPES.None) {
            let doorRatio = (doorSide === 'Right') ? 1.0 - this.doorRatio : this.doorRatio;
            let front_handle = DoorHandleGenerator.generate_handle(this.__handleType.description, 'Front', doorSide, doorRatio, this.frameWidth, this.frameSize, this.frameThickness, this.__openDirection.description, this.__doorHandleMaterialId);
            let back_handle = DoorHandleGenerator.generate_handle(this.__handleType.description, 'Back', doorSide, doorRatio, this.frameWidth, this.frameSize, this.frameThickness, this.__openDirection.description, this.__doorHandleMaterialId);

            aDoorGeometry.merge(front_handle);
            aDoorGeometry.merge(back_handle);
        }

        return aDoorGeometry;
    }

    __createDoorData(frameWidth, openingDirection, materialId = 1) {
        let doorModelData = this.__createForDoorModel(frameWidth, openingDirection, materialId);
        let geometry = new Geometry();
        let m = new Matrix4();
        let tx = (doorModelData.widthFactor * 0.5) * doorModelData.side;
        let ty = this.__frameHeight * 0.5;
        let tz = -(doorModelData.depth * 0.65);
        geometry.vertices = doorModelData.vertices;
        geometry.faces = doorModelData.faces;
        geometry.elementsNeedUpdate = true;

        m.makeRotationAxis(new Vector3(1, 0, 0), -Math.PI * 0.5);
        // m.multiply(new Matrix4().makeTranslation(0, tz, ty));
        // m.makeTranslation(tx, ty, tz);
        geometry.applyMatrix4(m);
        geometry.elementsNeedUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeFaceNormals();
        geometry.computeBoundingBox();
        return geometry; //new BufferGeometry().fromGeometry(geometry);
    }

    /**
     * Based on the DoorType the below method will change
     * This can be replaced by the appropriate door model class
     * This method will change with logic based on the door model type
     */
    __createForDoorModel(frameWidth, openingDirection, materialId = 1) {

        let gap = 0.25; //0.002;
        let sf = this.__frameSize;
        let wf = frameWidth - (sf * 2) - (gap * 2);
        let hf = (this.__frameHeight / 2) - (gap * 2);
        let deep = (this.__frameThickness * 0.50) - (gap * 3);
        let side = 0,
            minx = 0,
            maxx = 0;
        // # Open to right or left
        if (openingDirection === DOOR_OPEN_DIRECTIONS.RIGHT) {
            side = 1;
            minx = wf * -1;
            maxx = 0.0;
        } else {
            side = -1;
            minx = 0.0;
            maxx = wf;
        }
        let miny = 0.0; //# locked
        let maxy = deep;
        let minz = -hf;
        let maxz = hf - sf; // - gap;

        let faceids = [4, 5, 1, 0, 5, 6, 2, 1, 6, 7, 3, 2, 7, 4, 0, 3, 0, 1, 2, 3, 7, 6, 5, 4];
        // # Vertex
        let myvertex = [new Vector3(minx, miny, minz), new Vector3(minx, maxy, minz), new Vector3(maxx, maxy, minz), new Vector3(maxx, miny, minz), new Vector3(minx, miny, maxz), new Vector3(minx, maxy, maxz), new Vector3(maxx, maxy, maxz), new Vector3(maxx, miny, maxz)];
        // # Faces
        let myfaces = this.__convertFrom4ToFace3(faceids, materialId);
        // let myfaces = [new Face3(4, 5, 1, 0), new Face3(5, 6, 2, 1), new Face3(6, 7, 3, 2), new Face3(7, 4, 0, 3), new Face3(0, 1, 2, 3), new Face3(7, 6, 5, 4)];
        return { vertices: myvertex, faces: myfaces, widthFactor: wf, depth: deep, side: side };
    }

    get frameWidth() {
        return this.__frameWidth;
    }

    set frameWidth(value) {
        this.__frameWidth = (value) ? value : 100;
        this.__updateGeometry();
    }

    get frameHeight() {
        return this.__frameHeight;
    }

    set frameHeight(value) {
        this.__frameHeight = (value) ? value : 200;
        this.__updateGeometry();
    }

    get frameThickness() {
        return this.__frameThickness;
    }

    set frameThickness(value) {
        this.__frameThickness = (value) ? value : 20;
        this.__updateGeometry();
    }

    get frameSize() {
        return this.__frameSize;
    }

    set frameSize(value) {
        this.__frameSize = Math.max(5, Math.min(25, value)); //Expressed in centimeters
        this.__updateGeometry();
    }

    get doorRatio() {
        return this.__doorRatio;
    }

    set doorRatio(value) {
        this.__doorRatio = Math.max(0.0, Math.min(1.0, value)); //Expressed as a ratio between 0 -> 1
        this.__updateGeometry();
    }

    get doorHandleColor() {
        return `#${this.__doorHandleMaterial.color.getHexString()}`;
    }

    set doorHandleColor(color) {
        this.__doorHandleMaterial.color = new Color(color);
        this.__doorHandleMaterial.needsUpdate = true;
        this.__material.needsUpdate = true;
    }

    get doorGlassColor() {
        return `#${this.__glassMaterial.color.getHexString()}`;
    }

    set doorGlassColor(color) {
        this.__glassMaterial.color = new Color(color);
        this.__glassMaterial.needsUpdate = true;
        this.__material.needsUpdate = true;
    }

    get doorColor() {
        return `#${this.__doorMaterial.color.getHexString()}`;
    }

    set doorColor(color) {
        this.__doorMaterial.color = new Color(color);
        this.__doorMaterial.needsUpdate = true;
        this.__material.needsUpdate = true;
    }

    get frameColor() {
        return `#${this.__frameMaterial.color.getHexString()}`;
    }

    set frameColor(color) {
        this.__frameMaterial.color = new Color(color);
        this.__frameMaterial.needsUpdate = true;
        this.__material.needsUpdate = true;
    }

    // Apply a finishing image (the same swatches the Wall Properties picker
    // uses) to one of the door's surfaces. Loaded as a texture map with the base
    // colour reset to white so the texture shows true colours; for solid-colour
    // swatches the door simply takes that solid colour.
    // channel: 'frame' | 'door' | 'handle' | 'glass'
    setSurfaceMap(channel, url) {
        if (!url) return;
        let material = null;
        switch (channel) {
            case 'frame': material = this.__frameMaterial; break;
            case 'door': material = this.__doorMaterial; break;
            case 'handle': material = this.__doorHandleMaterial; break;
            case 'glass': material = this.__glassMaterial; break;
            default: return;
        }
        if (!material) return;
        // Remember the chosen finish URL so it persists (see metadata getter).
        this.__surfaceMaps = this.__surfaceMaps || {};
        this.__surfaceMaps[channel] = url;
        new TextureLoader().load(url, (texture) => {
            texture.wrapS = texture.wrapT = RepeatWrapping;
            material.map = texture;
            // A finish was chosen from the panel → show its true colours by
            // using a white base under the texture (same as walls/windows).
            material.color = new Color('#ffffff');
            material.needsUpdate = true;
            // Nudge the viewer to re-render via the geometry-updated handler
            // (it sets parent.needsUpdate).
            this.dispatchEvent({ type: EVENT_PARAMETRIC_GEOMETRY_UPATED, target: this });
        });
    }

    get openDirection() {
        return this.__openDirection.description;
    }

    set openDirection(direction) {
        switch (direction) {
            case DOOR_OPEN_DIRECTIONS.RIGHT.description:
                this.__openDirection = DOOR_OPEN_DIRECTIONS.RIGHT; //This value will be set in validatePArameters
                break;
            case DOOR_OPEN_DIRECTIONS.LEFT.description:
                this.__openDirection = DOOR_OPEN_DIRECTIONS.LEFT; //This value will be set in validatePArameters
                break;
            case DOOR_OPEN_DIRECTIONS.BOTH_SIDES.description:
                this.__openDirection = DOOR_OPEN_DIRECTIONS.BOTH_SIDES; //This value will be set in validatePArameters
                break;
            case DOOR_OPEN_DIRECTIONS.NO_DOORS.description:
                this.__openDirection = DOOR_OPEN_DIRECTIONS.NO_DOORS; //This value will be set in validatePArameters
                break;
        }
        this.__updateGeometry();
    }

    get handleType() {
        return this.__handleType.description;
    }

    set handleType(type) {
        switch (type) {
            case DOOR_HANDLE_TYPES.None.description:
                this.__handleType = DOOR_HANDLE_TYPES.None; //This value will be set in validatePArameters
                break;
            case DOOR_HANDLE_TYPES.HANDLE_01.description:
                this.__handleType = DOOR_HANDLE_TYPES.HANDLE_01; //This value will be set in validatePArameters
                break;
            case DOOR_HANDLE_TYPES.HANDLE_02.description:
                this.__handleType = DOOR_HANDLE_TYPES.HANDLE_02; //This value will be set in validatePArameters
                break;
            case DOOR_HANDLE_TYPES.HANDLE_03.description:
                this.__handleType = DOOR_HANDLE_TYPES.HANDLE_03; //This value will be set in validatePArameters
                break;
            case DOOR_HANDLE_TYPES.HANDLE_04.description:
                this.__handleType = DOOR_HANDLE_TYPES.HANDLE_04; //This value will be set in validatePArameters
                break;
        }
        this.__updateGeometry();
    }

    get doorType() {
        return this.__doorType;
    }

    get geometry() {
        return this.__geometry;
    }

    get material() {
        return this.__material;
    }

    get metadata() {
        const sm = this.__surfaceMaps || {};
        return {
            type: this.__doorType,
            frameColor: this.__frameMaterial.color,
            doorColor: this.__doorMaterial.color,
            doorHandleColor: this.__doorHandleMaterial.color,
            glassColor: this.__glassMaterial.color,
            frameWidth: this.frameWidth,
            frameHeight: this.frameHeight,
            frameSize: this.frameSize,
            frameThickness: this.frameThickness,
            doorRatio: this.doorRatio,
            openDirection: this.__openDirection.description,
            handleType: this.__handleType.description,
            // Persist chosen finish textures so they survive reload.
            frameMap: sm.frame || null,
            doorMap: sm.door || null,
            handleMap: sm.handle || null,
            glassMap: sm.glass || null
        };
    }


    get parameters() {
        return {
            frameColor: { type: 'color' },
            doorColor: { type: 'color' },
            doorHandleColor: { type: 'color' },
            doorGlassColor: { type: 'color' },
            frameWidth: { type: 'number' },
            frameHeight: { type: 'number' },
            frameSize: { type: 'range', min: 5, max: 25, step: 0.1 },
            frameThickness: { type: 'number' },
            doorRatio: { type: 'range', min: 0.2, max: 0.8, step: 0.001 },
            openDirection: {
                type: 'choice',
                value: [
                    DOOR_OPEN_DIRECTIONS.RIGHT.description,
                    DOOR_OPEN_DIRECTIONS.LEFT.description,
                    DOOR_OPEN_DIRECTIONS.BOTH_SIDES.description,
                    DOOR_OPEN_DIRECTIONS.NO_DOORS.description
                ]
            },
            handleType: {
                type: 'choice',
                value: [
                    DOOR_HANDLE_TYPES.None.description,
                    DOOR_HANDLE_TYPES.HANDLE_01.description,
                    DOOR_HANDLE_TYPES.HANDLE_02.description,
                    DOOR_HANDLE_TYPES.HANDLE_03.description,
                    DOOR_HANDLE_TYPES.HANDLE_04.description
                ]
            }
        };
    }

    get name() {
        return this.__name;
    }

    set name(value) {
        this.__name = value;
    }
}