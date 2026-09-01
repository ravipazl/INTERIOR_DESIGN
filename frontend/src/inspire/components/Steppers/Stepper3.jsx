import React, { useContext } from "react";
import "./index.css";
import Stepper3Expanded from "./Stepper3Expanded";
import Stepper3Collapsed from "./Stepper3Collapsed";
import { StepperContext } from "../../context/StepperContext";

const Stepper3 = () => {
  const { activeStep } = useContext(StepperContext);

  return <>{activeStep === 3 &&(<Stepper3Expanded />)} {activeStep !== 3 &&(<Stepper3Collapsed />)}</>;
};

export default Stepper3;
