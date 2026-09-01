import {
  EventDispatcher,
  HemisphereLight,
  HemisphereLightHelper,
  AmbientLightHelper,
  DirectionalLightHelper,
  DirectionalLight,
  AmbientLight,
  Vector3,
  Vector2,
  Object3D,
  PointLight,
  PointLightHelper,
} from "three";
import { EVENT_UPDATED } from "../core/events.js";
import BlueprintInterface from "@pazl/blueprint-interface.js";
import { config } from "../core/configuration.js";

export class Lights3D extends EventDispatcher {
  constructor(scene, floorplan, room) {
    super();
    this.scene = scene;
    this.floorplan = floorplan;
    this.room = room;
    this.tol = 1;
    this.height = 500; // TODO: share with Blueprint.Wall
    this.dirLight = null;
    this.helpersize = 60;
    this.helperColor = 0x000000;
    this.pointLight = null;
    this.pointLightHelper = null;
    this.updatedroomsevent = () => {
      this.updateShadowCamera();
    };
    if (room) {
      //this.addRoomLight();
    } else {
      this.init();
    }
  }

  getDirLight() {
    return this.dirLight;
  }

  init() {
    //let size = this.floorplan.getSize();
    //let d = (Math.max(size.z, size.x) + this.tol) / 2.0;
    //let center = this.floorplan.getCenter();
    //let pos = new Vector3(center.x, this.height, center.z);
    //var light = new HemisphereLight(0xffffff, 0xffffff, 1.3);
    //light.position.set(0, this.height, 0);
    //this.scene.add(light);
    //const HemisphereLighthelper = new HemisphereLightHelper(
    //  light,
    //  this.helpersize,
    //  this.helperColor
    //);
    //HemisphereLighthelper.visible = true;
    //this.scene.add(HemisphereLighthelper);
    this.dirLight = new DirectionalLight(0xffffff, 1);
    this.dirLight.position.set(500, 500, 500);
    this.dirLight.target.position.set(0, 0, 0);
    this.dirLight.target.updateMatrixWorld();
    this.dirLight.castShadow = true;
    this.scene.add(this.dirLight);
    // const DirectionalLighthelper = new DirectionalLightHelper(
    //   this.dirLight,
    //   50,
    //   0xff0000
    // );
    // this.scene.add(DirectionalLighthelper);
    this.ambLight = new AmbientLight(0x404040); // soft white light
    //this.ambLight.position.set(0, 50, 0);
    this.ambLight.intensity = 1;
    this.scene.add(this.ambLight);
    //this.dirLight.castShadow = true;
    //this.dirLight.shadow.mapSize.width = 1024;
    //this.dirLight.shadow.mapSize.height = 1024;
    this.floorplan.addEventListener(EVENT_UPDATED, this.updatedroomsevent);
  }
  addRoomLight() {
    console.debug("addRoomLight", this.room);
    this.pointLight = new PointLight(0xffffff, 0.5);
    this.pointLight.position.set(
      this.room.center.x,
      config.wallHeight - 100,
      this.room.center.z
    );
    this.pointLight.castShadow = true;
    //this.scene.add(this.pointLight);
    //this.PointLightHelper = new PointLightHelper(this.pointLight, 50, 0xff0000);
    //this.scene.add(this.PointLightHelper);
  }

  remove() {
    this.floorplan.removeEventListener(EVENT_UPDATED, this.updatedroomsevent);
    //this.scene.remove(this.ambLight);
    //this.scene.remove(this.pointLight);
    //this.scene.remove(this.PointLightHelper);
  }

  updateShadowCamera() {
    //var size = this.floorplan.getSize();
    //var d = (Math.max(size.z, size.x) + this.tol) / 2.0;
    //var center = this.floorplan.getCenter();
    //var pos = new Vector3(center.x, this.height, center.z);
    //this.dirLight.position.copy(pos);
    //this.dirLight.target.position.copy(center);
    //dirLight.updateMatrix();
    //dirLight.updateWorldMatrix()
    //this.dirLight.shadow.camera.left = -d;
    //this.dirLight.shadow.camera.right = d;
    //this.dirLight.shadow.camera.top = d;
    //this.dirLight.shadow.camera.bottom = -d;
    // this is necessary for updates
    //if (this.dirLight.shadowCamera) {
    //  this.dirLight.shadow.camera.left = this.dirLight.shadowCameraLeft;
    //  this.dirLight.shadow.camera.right = this.dirLight.shadowCameraRight;
    //  this.dirLight.shadow.camera.top = this.dirLight.shadowCameraTop;
    //  this.dirLight.shadow.camera.bottom = this.dirLight.shadowCameraBottom;
    //  this.dirLight.shadowCamera.updateProjectionMatrix();
    //}
  }

  // remove() {
  //   if (this.ambLight) {
  //     console.debug("Lights3D.remove -> this.ambLight", this.ambLight);
  //     this.scene.remove(this.ambLight);
  //   }
  //   if (this.pointLight) {
  //     console.debug("Lights3D.remove -> this.pointLight", this.pointLight);
  //     this.scene.remove(this.pointLight);
  //   }
  //   if (this.pointLightHelper) {
  //     //console.debug("Lights3D.remove -> this.pointLightHelper", this.pointLightHelper);
  //     //this.scene.remove(this.pointLightHelper);
  //   }
  // }
}
