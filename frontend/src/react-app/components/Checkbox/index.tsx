import React, { useState } from "react";
import "./index.css";

interface CheckboxProps {
  checked: boolean;
  canChange: boolean;
  onChange: (value: any) => void;
}

const Checkbox = ({ checked, canChange, onChange }: CheckboxProps) => {
  const [isChecked, setIsChecked] = useState(checked);

  const handleCheck = () => {
    if (canChange) {
      setIsChecked(!isChecked);
      onChange(!isChecked);
    }
  };

  return (
    <div onClick={handleCheck}>
      <input
        className="pazl-checkbox"
        type="checkbox"
        checked={isChecked}
        onChange={handleCheck}
      />
      {isChecked ? (
        <img
          className="pazl-checkbox-check"
          src={require("../../images/checked.png")}
          width={20}
          height={20}
        />
      ) : (
        <img
          className="pazl-checkbox-uncheck"
          src={require("../../images/unchecked.png")}
          width={20}
          height={20}
        />
      )}
    </div>
  );
};

export default Checkbox;
