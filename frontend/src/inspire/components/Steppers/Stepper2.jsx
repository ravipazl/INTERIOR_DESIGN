import React, { useState } from "react";
import "./index.css";
import Stepper2Expanded from "./Stepper2Expanded";
import Stepper2Collapsed from "./Stepper2Collapsed";
import { StepperContext } from "../../context/StepperContext";
import { useContext } from "react";

const Stepper2 = ({ themeArray,  }) => {
  const { activeStep } = useContext(StepperContext);
  return <>{activeStep === 2 &&(<Stepper2Expanded  />)} {activeStep !== 2 && (<Stepper2Collapsed themeArray={themeArray} />)}</>;
};

export default Stepper2;
