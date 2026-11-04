import React from "react";
import { ChildTemplateCardProps } from "../../../models/template.card";

const TemplateCard = ({
  template,
  onTemplateSelect,
  onRequestDelete,
}: ChildTemplateCardProps) => {
  return (
    <div className="pz-tm-card" key={template.id}>
      {template.isCustom && onRequestDelete && (
        <button
          type="button"
          title="Delete this template"
          aria-label={`Delete ${template.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete(template);
          }}
          className="pz-tm-del"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
      <div className="pz-tm-thumb">
        <img src={template.coverImageUrl} alt={template.title} />
      </div>
      <div className="pz-tm-info">
        <h5 className="pz-tm-name">{template.title}</h5>
        <span
          className={`pz-tm-size${template.isCustom ? " pz-tm-size--custom" : ""}`}
        >
          {template.size}
        </span>
      </div>
      <button type="button" onClick={onTemplateSelect} className="pz-tm-btn pz-tm-btn--primary pz-tm-use">
        Use this plan
      </button>
    </div>
  );
};

export default TemplateCard;
