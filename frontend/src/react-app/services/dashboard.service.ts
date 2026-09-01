import axios from "./http.service";
import {MODEL_LIST,TEXTURE_LIST} from '../../scripts/core/constants';

export const getAllModels = async () => {
    try {
      const response = await axios.get(MODEL_LIST);
      return response.data;
    } catch (err) {
      return err;
    }
  };

  export const getAllModelsTexture = async () => {
    try {
      const response = await axios.get(TEXTURE_LIST);
      return response.data;
    } catch (err) {
      return err;
    }
  };