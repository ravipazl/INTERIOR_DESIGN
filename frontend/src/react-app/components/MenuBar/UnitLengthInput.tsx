import React, { useEffect, useState } from "react";
import {
  displayTextToMm,
  mmToDisplayText,
  useDisplayUnit,
} from "@pazl/utils/unitsUtils.js";

/**
 * A length box: holds mm, shows and takes the display unit. The value commits
 * on blur or Enter, so "3." or "3'" part way through typing is left alone.
 *
 * Nothing is committed unless the text was edited: a size shown rounded (910 mm
 * reads 3'0") must not be saved back as 914 mm just by clicking through the box.
 */
const UnitLengthInput: React.FC<{
  valueMm: number;
  onCommit: (mm: number) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">> = ({
  valueMm,
  onCommit,
  ...inputProps
}) => {
  const unit = useDisplayUnit();
  const shown = mmToDisplayText(valueMm, unit);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    if (draft === shown) return;
    const mm = displayTextToMm(draft, unit);
    if (mm === null) setDraft(shown);
    else onCommit(mm);
  };

  return (
    <input
      type="text"
      inputMode="text"
      {...inputProps}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

export default UnitLengthInput;
