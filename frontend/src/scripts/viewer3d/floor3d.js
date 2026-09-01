import { EventDispatcher, TextureLoader, RepeatWrapping, MeshBasicMaterial, FrontSide, DoubleSide, Vector2, Vector3, Face3, Geometry, Shape, ShapeGeometry, Mesh } from 'three';
import { EVENT_CHANGED, EVENT_UPDATE_TEXTURES, EVENT_ROOM_ATTRIBUTES_CHANGED, EVENT_MODIFY_TEXTURE_ATTRIBUTE } from '../core/events.js';
import { Configuration, configWallHeight } from '../core/configuration.js';
import { BufferGeometry } from 'three/build/three.module';
import { FloorMaterial3D } from '../materials/FloorMaterial3D.js';
import { TEXTURE_PROPERTY_COLOR } from '../core/constants.js';

export class Floor3D extends EventDispatcher {
    constructor(scene, room, controls, opts) {
        super();

        let options = { occludedRoofs: false };
        for (let opt in options) {
            if (options.hasOwnProperty(opt) && opts.hasOwnProperty(opt)) {
                options[opt] = opts[opt];
            }
        }
        this.__options = options;

        this.scene = scene;
        this.room = room;
        this.controls = controls;
        this.floorPlane = null;
        this.roofPlane = null;
        this.changedevent = this.redraw.bind(this);
        this.__materialChangedEvent = this.__updateTexturePack.bind(this);
        this.__updateReflectionsEvent = this.__updateReflections.bind(this);

        this.__floorMaterial3D = null;

        this.room.addEventListener(EVENT_ROOM_ATTRIBUTES_CHANGED, this.changedevent);
        this.room.addEventListener(EVENT_CHANGED, this.changedevent);

        this.room.addEventListener(EVENT_UPDATE_TEXTURES, this.__materialChangedEvent);
        this.room.addEventListener(EVENT_MODIFY_TEXTURE_ATTRIBUTE, this.__materialChangedEvent);

        this.controls.addEventListener('change', this.__updateReflectionsEvent);
        this.init();
    }

    __updateReflections() {
        if (this.__floorMaterial3D && this.__floorMaterial3D.isReflective && this.scene.enabled) {
            let floorSize = this.room.floorRectangleSize.clone();
            this.floorPlane.visible = false;
            this.__floorMaterial3D.envMapCamera.clear(this.scene.renderer);
            this.__floorMaterial3D.envMapCamera.position.set(floorSize.x, 0, floorSize.y);
            this.__floorMaterial3D.envMapCamera.update(this.scene.renderer, this.scene);
            this.floorPlane.visible = true;
            this.__floorMaterial3D.needsUpdate = true;
        }
    }

    __updateTexturePack(evt) {
        if (evt.type === EVENT_UPDATE_TEXTURES) {
            let floorSize = this.room.floorRectangleSize.clone();
            let texturePack = this.room.getTexture();

            // Lighter / cooler Coohom-style wood floor: gently cool-tint the
            // floor texture (very light cool multiplier so it barely darkens but
            // shifts the warm wood cooler). Work on a COPY so saved data is
            // untouched, and only when there's an actual floor texture image.
            if (texturePack && texturePack.colormap) {
                texturePack = { ...texturePack, color: '#EDEFF2' };
            }

            if (!this.__floorMaterial3D) {
                this.__floorMaterial3D = new FloorMaterial3D({ color: texturePack.color, side: DoubleSide }, texturePack, this.scene);
            }
            this.__floorMaterial3D.textureMapPack = texturePack;
            // this.__floorMaterial3D.updateDimensions(floorSize.x, floorSize.y);
            this.__floorMaterial3D.dimensions = floorSize;
        } else if (evt.type === EVENT_MODIFY_TEXTURE_ATTRIBUTE) {
            if (this.__floorMaterial3D) {
                let attribute = evt.attribute;
                let value = evt.value;
                if (attribute === TEXTURE_PROPERTY_COLOR) {
                    this.__floorMaterial3D.textureColor = value;
                }
            }
        }
        this.scene.needsUpdate = true;
    }

    switchWireframe(flag) {
        this.floorPlane.visible = !flag;
        this.roofPlane.visible = !flag;
    }

    init() {
        this.__updateTexturePack({ type: EVENT_UPDATE_TEXTURES });
        this.redraw();
    }

    redraw() {
        this.removeFromScene();
        this.floorPlane = this.buildFloor();
        this.roofPlane = this.buildRoofVaryingHeight();
        this.addToScene();
    }

    buildFloor() {
        let points = [];
        this.room.interiorCorners.forEach((corner) => {
            points.push(new Vector2(corner.x, corner.y));
        });
        let floorSize = this.room.floorRectangleSize.clone();
        let shape = new Shape(points);
        let geometry = new ShapeGeometry(shape);

        geometry.faceVertexUvs[0] = [];

        geometry.faces.forEach((face) => {
            let vertA = geometry.vertices[face.a];
            let vertB = geometry.vertices[face.b];
            let vertC = geometry.vertices[face.c];
            geometry.faceVertexUvs[0].push([vertexToUv(vertA), vertexToUv(vertB), vertexToUv(vertC)]);
        });

        function vertexToUv(vertex) {
            let x = vertex.x / floorSize.x;
            let y = vertex.y / floorSize.y;
            return new Vector2(x, y);
        }

        geometry.faceVertexUvs[1] = geometry.faceVertexUvs[0];
        geometry.computeFaceNormals();
        geometry.computeVertexNormals();
        geometry.uvsNeedUpdate = true;
        let useGeometry = new BufferGeometry().fromGeometry(geometry);
        // this.__floorMaterial3D.updateDimensions(floorSize.x, floorSize.y);

        this.__floorMaterial3D.dimensions = floorSize;
        if (this.__floorMaterial3D.envMapCamera) {
            this.__floorMaterial3D.envMapCamera.position.copy(new Vector3(floorSize.x, 0, floorSize.y));
        }

        let floor = new Mesh(useGeometry, this.__floorMaterial3D);
        floor.rotation.set(Math.PI * 0.5, 0, 0);
        floor.receiveShadow = true;
        return floor;
    }

    buildRoofVaryingHeight() {
        let side = (this.room.isLocked || this.__options.occludedRoofs) ? DoubleSide : FrontSide;
        // Ceiling colour comes from the room (set via Room Properties → Ceiling
        // color); falls back to the default light grey. Read here so it survives
        // every redraw.
        // Ceiling finish — prefer the SAVED value on the floorplan (survives
        // reload), then the runtime value, else the default grey.
        let savedCeil = null;
        try {
            if (this.room && this.room.floorplan && this.room.floorplan.getCeilingTexture) {
                savedCeil = this.room.floorplan.getCeilingTexture(this.room.getUuid());
            }
        } catch (e) { /* ignore */ }
        let ceilUrl = (savedCeil && savedCeil.textureUrl) ||
            (this.room && this.room.__ceilingTextureUrl) || null;
        let ceilColor = (savedCeil && savedCeil.color != null) ? savedCeil.color :
            ((this.room && this.room.__ceilingColor != null) ? this.room.__ceilingColor : 0xe5e5e5);
        let roofMaterial = new MeshBasicMaterial({ side: side, color: ceilColor });
        if (ceilUrl) {
            // keep the runtime prop in sync so redraws stay consistent
            if (this.room) this.room.__ceilingTextureUrl = ceilUrl;
            let ctex = new TextureLoader().load(ceilUrl);
            ctex.wrapS = ctex.wrapT = RepeatWrapping;
            roofMaterial.map = ctex;
            roofMaterial.color.set(0xffffff);
        }

        let spoints = [];
        let shape = null;
        let shapeGeometry = null;
        let roof = null;

        // this.room.interiorCorners.forEach((corner) => {
        //     spoints.push(new Vector2(corner.x, corner.y));
        // });

        this.room.corners.forEach((corner) => {
            spoints.push(new Vector2(corner.x, corner.y));
        });

        shape = new Shape(spoints);
        shapeGeometry = new ShapeGeometry(shape);
        let cornerIndex = shapeGeometry.vertices.length - 1;
        // console.log('===================================');
        // console.log('COUNTS ::: ', this.room.corners.length, shapeGeometry.vertices.length);
        for (let i = 0; i < shapeGeometry.vertices.length; i++) {
            // let index = (this.room.corners.length-i)-1;
            let corner = this.room.corners[cornerIndex];
            let vertex = shapeGeometry.vertices[i];
            vertex.z = vertex.y;
            vertex.y = corner.elevation + 0.3;
            cornerIndex--;
            // console.log('CORNER LOCATION ::: ', corner.location);
            // console.log('VERTEX ::: ', vertex);
        }
        // console.log('===================================');
        roof = new Mesh(shapeGeometry, roofMaterial);


        // let geometry = new Geometry();

        // this.room.corners.forEach((corner) => {
        //     let vertex = new Vector3(corner.x, corner.elevation, corner.y);
        //     geometry.vertices.push(vertex);
        // });
        // for (let i = 2; i < geometry.vertices.length; i++) {
        //     let face = new Face3(0, i - 1, i);
        //     geometry.faces.push(face);
        // }
        // let roof = new Mesh(geometry, roofMaterial);
        // roof.rotation.set(Math.PI / 2, 0, 0);
        // roof.position.y = Configuration.getNumericValue(configWallHeight);
        return roof;
    }


    buildRoofUniformHeight() {
        // setup texture
        var roofMaterial = new MeshBasicMaterial({ side: FrontSide, color: 0xe5e5e5 });
        var points = [];
        this.room.interiorCorners.forEach((corner) => {
            points.push(new Vector2(corner.x, corner.y));
        });
        var shape = new Shape(points);
        var geometry = new ShapeGeometry(shape);
        var roof = new Mesh(geometry, roofMaterial);
        roof.rotation.set(Math.PI / 2, 0, 0);
        roof.position.y = Configuration.getNumericValue(configWallHeight);
        return roof;
    }

    addToScene() {
        this.scene.add(this.floorPlane);
        this.scene.add(this.roofPlane);
        // Adaptive ceiling: honour the viewer's current show/hide decision on
        // every (re)draw, so adding furniture / editing never resets the roof.
        if (this.scene && this.scene.__ceilingShown === false && this.roofPlane) {
            this.roofPlane.visible = false;
        }
        // Floor opacity (Coohom "Floor %" slider) — re-applied on every redraw.
        let fop = this.scene && this.scene.__floorOpacity;
        if (fop != null && fop < 1 && this.floorPlane && this.floorPlane.material) {
            this.floorPlane.material.transparent = true;
            this.floorPlane.material.opacity = fop;
            this.floorPlane.material.depthWrite = false;
            this.floorPlane.material.needsUpdate = true;
        }
        //scene.add(roofPlane);
        // hack so we can do intersect testing
        // this.scene.add(this.room.floorPlane);
        // this.scene.add(this.room.roofPlane);
    }

    removeFromScene() {
        this.scene.remove(this.floorPlane);
        this.scene.remove(this.roofPlane);
        // this.scene.remove(this.room.floorPlane);
        // this.scene.remove(this.room.roofPlane);
    }

    showRoof(flag) {

        // this.roofPlane.visible = flag;
    }

    destroy() {
        this.room.removeEventListener(EVENT_CHANGED, this.changedevent);
        this.room.removeEventListener(EVENT_UPDATE_TEXTURES, this.__materialChangedEvent);
        this.controls.removeEventListener('change', this.__updateReflectionsEvent);
        this.removeFromScene();
    }
}