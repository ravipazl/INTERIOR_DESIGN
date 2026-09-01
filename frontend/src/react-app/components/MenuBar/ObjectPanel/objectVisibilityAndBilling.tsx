import React from "react";
import { FurnishedModel } from "@pazl/entities/FurnishedModel";
import Checkbox from "@pazl/components/Checkbox";

interface ObjectVisibilityAndBillingProps {
  selectedModel: FurnishedModel;
  isDarkMode: boolean;
}

function ObjectVisibilityAndBilling({
  selectedModel,
  isDarkMode,
}: ObjectVisibilityAndBillingProps) {
  const handleOnChange = (val: any) => {
    console.debug("ObjectVisibilityAndBilling.tsx ~ handleOnChange", val);
  };

  return (
    <div className="flex m-2.5 items-center align-center">
      <Checkbox
        checked={selectedModel?.model?.isPazlSupplied}
        canChange={false}
        onChange={handleOnChange}
      />
      <span className="ml-1 text-sm font-semibold leading-tight text-primary dark:text-neutral-200">
        Pazl Supplied
      </span>
    </div>
  );
}

export default ObjectVisibilityAndBilling;
