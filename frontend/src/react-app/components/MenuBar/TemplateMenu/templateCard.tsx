import React from "react";
import { TERipple } from "tw-elements-react";
import {
  ChildTemplateCardProps,
  TemplateCardProps,
} from "../../../models/template.card";

const TemplateCard = ({
  template,
  onTemplateSelect,
  onRequestDelete,
}: ChildTemplateCardProps) => {
  return (
    <div
      className="relative w-[200px] h-[300px] flex flex-col flex-shrink-0 items-center border-slate-400 rounded-lg bg-white shadow-[0px_0px_8px_0_rgba(0,0,0,0.15)] p-4 m-1 dark:bg-neutral-700"
      key={template.id}
    >
      {template.isCustom && onRequestDelete && (
        <button
          type="button"
          title="Delete this template"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete(template);
          }}
          className="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full text-base leading-none text-gray-400 hover:bg-red-500 hover:text-white"
        >
          ×
        </button>
      )}
      <img
        src={template.coverImageUrl}
        alt={template.title}
        className="h-28 w-full object-contain mb-2"
      />
      <div className="flex flex-col flex-1 w-full">
        <h5 className="font-semibold text-sm text-center pb-1 dark:text-[#FFFFFF]">
          {template.title}
        </h5>
        <p className="font-normal text-sm text-center pb-2 dark:text-[#FFFFFF]">{template.size}</p>
        <TERipple className="flex justify-center mt-auto">
          <button
            type="button"
            onClick={onTemplateSelect}
            className="inline-block rounded bg-primary px-6 pb-2 pt-2.5 text-xs font-medium 
                        uppercase leading-normal text-white shadow-[0_4px_9px_-4px_#3b71ca] transition 
                        duration-150 ease-in-out hover:bg-primary-600 
                        hover:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.3),0_4px_18px_0_rgba(59,113,202,0.2)] 
                        focus:bg-primary-600 focus:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.3),0_4px_18px_0_rgba(59,113,202,0.2)] 
                        focus:outline-none focus:ring-0 active:bg-primary-700 active:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.3),0_4px_18px_0_rgba(59,113,202,0.2)] 
                        dark:shadow-[0_4px_9px_-4px_rgba(59,113,202,0.5)] 
                        dark:hover:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.2),0_4px_18px_0_rgba(59,113,202,0.1)] 
                        dark:focus:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.2),0_4px_18px_0_rgba(59,113,202,0.1)] 
                        dark:active:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.2),0_4px_18px_0_rgba(59,113,202,0.1)]"
          >
            Select
          </button>
        </TERipple>
      </div>
    </div>
  );
};

export default TemplateCard;
