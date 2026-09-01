import React, { useContext, useState, useEffect } from "react";
import "./index.css";
import Stepper1Expanded from "./Stepper1Expanded";
import Stepper1Collapsed from "./Stepper1Collapsed";
import { StepperContext } from "../../context/StepperContext";

const Stepper1 = ({ rooms, setRooms, themeArray }) => {
  const { activeStep } = useContext(StepperContext);
  return (
    <>
      {activeStep === 1 && (
        <Stepper1Expanded rooms={rooms} setRooms={setRooms} themeArray={themeArray} />
      )}
      {activeStep !== 1 && (
        <Stepper1Collapsed rooms={rooms} setRooms={setRooms} themeArray={themeArray} />
      )}
    </>
  );
};

export default Stepper1;
