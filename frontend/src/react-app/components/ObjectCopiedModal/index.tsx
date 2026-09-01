import React, { useEffect, useState } from "react";
import Draggable from "react-draggable";
import { capitalizeText } from "@pazl/utils/genericFunctions";
import "./index.css";

function ObjectCopiedModal({ selectedModel }: any) {
  const isDarkMode = localStorage.getItem("isDarkMode") === "true" || false;
  const [item, setItem] = useState<any>(null);

  useEffect(() => {
    if (selectedModel) {
      setItem({
        thumbnail: selectedModel?.thumbnail
          ? selectedModel?.thumbnail
          : selectedModel?.model?.thumbnail
          ? selectedModel?.model?.thumbnail
          : "",
        name: selectedModel?.name
          ? selectedModel?.name
          : selectedModel?.model?.name
          ? selectedModel?.model?.name
          : "",
      });
    }
  }, [selectedModel]);

  return (
    <>
      {item ? (
        <Draggable handle="strong">
          <div className="box absolute top-36 left-3 z-10 w-60 h-60 max-h-60 shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)] bg-[#fff]">
            <div className="flex flex-col justify-items-center items-center p-2 mt-2">
              <figure className="inline-block max-w-sm">
                <img
                  src={item.thumbnail}
                  className="h-full max-h-32 align-middle shadow-lg"
                  alt={item.name ?? "_"}
                />
              </figure>
              <p className="font-bold text-sm text-[#414063] flex items-center mb-1 p-2 dark:text-neutral-200">
                {capitalizeText(item.name)}
              </p>
            </div>
            <div className="copy-modal-title">Model copied successfully!</div>
          </div>
        </Draggable>
      ) : null}
    </>
  );
}

export default ObjectCopiedModal;
