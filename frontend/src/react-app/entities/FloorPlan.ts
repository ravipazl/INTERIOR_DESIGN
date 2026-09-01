import {
  LocalDBManager,
  LocalDBObjectStores,
} from "../services/LocalDBManager";

export interface FloorPlanType {
  _id: string;
  projectId: string;
  scene: string;
}

export class FloorPlan extends LocalDBManager {
  _id: string;
  projectId: string;
  scene: string;

  constructor(props: FloorPlanType) {
    super();
    this._id = props._id;
    this.projectId = props.projectId;
    this.scene = props.scene;
  }

  async update(scene: string) {
    const data = {
      _id: this._id,
      projectId: this.projectId,
      scene: scene,
    };
    const savedEntityId = await this.updateToLocalDB(
      data,
      LocalDBObjectStores.FLOOR_PLAN
    );
    return savedEntityId;
  }

  async save() {
    const data = {
      _id: this._id,
      projectId: this.projectId,
      scene: this.scene,
    };
    if (!this._id) {
      delete data._id;
    }
    const savedEntityId = await this.saveToLocalDB(
      data,
      LocalDBObjectStores.FLOOR_PLAN
    );
    return savedEntityId;
  }
}
