import React, { createContext, useContext, useReducer } from "react";

const initialState = {
  activeStep: 1,
  selectedImage: {},
  generatedAIImage: null,
  triggerAIGeneration: false
};

export const StepperContext = React.createContext();

const stepperReducer = (state, action) => {
  switch (action.type) {

    case "SET_ACTIVE_STEP":
      return { ...state, activeStep: action.payload };
    case "NEXT_STEP":
      return { ...state, activeStep: state.activeStep + 1 };
    case "PREVIOUS_STEP":
      return { ...state, activeStep: state.activeStep - 1 };
    case "SET_SELECTED_IMAGE":
      return { ...state, selectedImage: action.payload };
    case "SET_GENERATED_AI_IMAGE":
      return { ...state, generatedAIImage: action.payload };
    case "TRIGGER_AI_GENERATION":
      return { ...state, triggerAIGeneration: action.payload };
    default:
      return state;
  }
};
export const StepperProvider = ({ children }) => {
  const [state, dispatch] = useReducer(stepperReducer, initialState);


  const setActiveStep = (value) => {
    console.log("Setting active step to:", value);
    dispatch({ type: "SET_ACTIVE_STEP", payload: value });
  };

  const handleNext = () => {
    dispatch({ type: "NEXT_STEP" });
  };

  const handleBack = () => {
    dispatch({ type: "PREVIOUS_STEP" });
  };

  const setSelectedImage = (image) => {
    dispatch({ type: "SET_SELECTED_IMAGE", payload: image });
  };

  const setSelectedThemeImage = (image) => {
    dispatch({ type: "SET_SELECTED_THEME_IMAGE", payload: image });
  };

  const setGeneratedAIImage = (value) => {
    dispatch({ type: "SET_GENERATED_AI_IMAGE", payload: value });
  };

  const setTriggerAIGeneration = (value) => {
    dispatch({ type: "TRIGGER_AI_GENERATION", payload: value });
  };

  return (
    <StepperContext.Provider
      value={{
        activeStep: state.activeStep,
        selectedImage: state.selectedImage,
        selectedThemeImage: state.selectedThemeImage,
        generatedAIImage: state.generatedAIImage,
        setActiveStep,
        setSelectedImage,
        setSelectedThemeImage,
        setGeneratedAIImage,
        handleNext,
        handleBack,
        triggerAIGeneration: state.triggerAIGeneration,
        setTriggerAIGeneration
      }}
    >
      {children}
    </StepperContext.Provider>
  );
};
