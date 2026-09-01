export interface ModelComponentType {
  _id: string;
  modelId: string;
  parentComponentId: string;
  name: string;
  position: number[];
  scale: number[];
  rotation: number[];
  baseMaterialProperties: string;
  componentProperties: {};
  textureId: string;
  visible: boolean;
  exposed: boolean;
  locationWithinParent: string;
  modelDefaultValues: any[];
  dimensions: number[];
}

export class ModelComponent {
  _id: string;
  modelId: string;
  parentComponentId: string;
  name: string;
  position: number[];
  scale: number[];
  rotation: number[];
  baseMaterialProperties: string;
  componentProperties: any;
  textureId: string;
  visible: boolean;
  exposed: boolean;
  locationWithinParent: string;
  modelDefaultValues: any[];
  dimensions: number[];

  constructor(props: ModelComponentType) {
    this._id = props._id;
    this.modelId = props.modelId;
    this.parentComponentId = props.parentComponentId;
    this.name = props.name;
    this.position = props.position;
    this.scale = props.scale;
    this.rotation = props.rotation;
    this.baseMaterialProperties = props.baseMaterialProperties;
    this.componentProperties = props.componentProperties;
    this.textureId = props.textureId;
    this.visible = props.visible;
    this.exposed = props.exposed;
    this.locationWithinParent = props.locationWithinParent;
    this.modelDefaultValues = props.modelDefaultValues;
    this.dimensions = props.dimensions;
  }
}
