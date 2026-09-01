import { ParametricBaseWindow } from "./ParametricBaseWindow";

export const WINDOW_TYPES = { 1: ParametricBaseWindow };

/** Factory for parametric window classes (mirrors DoorFactory). */
export class WindowFactory {
  static getClass(windowType) {
    return WINDOW_TYPES[windowType] || ParametricBaseWindow;
  }
}
