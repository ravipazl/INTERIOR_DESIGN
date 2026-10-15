import React, { useRef } from "react";
import "./index.css";
import BoqTable from "../BoqTable";
import RenderHistory from "../RenderHistory";

const ProductionMenu = ({ activeTab, projectId }: any) => {
  // BoqTable fills this with its "build BOQ PDF" function; RenderHistory calls it
  // when the architect sends for approval, so the BOQ is attached to the email.
  const boqPdfGetter = useRef<(() => Promise<Blob | null>) | null>(null);

  // The BOQ and the render history live together on this page: "Send to admin"
  // submits both as one package, and RenderHistory pulls the BOQ PDF straight
  // from BoqTable below. They were briefly split across two rail items, which
  // meant only one was mounted and the email silently lost its attachment.
  //
  // "Full Room View" used to sit at the top of this page. It works on the live
  // 3D scene, so it moved to the 3D editor's toolbar, beside One room / All
  // rooms (MenuBar/furnishMenu.tsx).

  return (
    <div className="production-container bg-white dark:bg-[#333333]">
      <div>
        <BoqTable
          projectId={projectId}
          activeTab={activeTab}
          registerPdfGetter={(fn) => {
            boqPdfGetter.current = fn;
          }}
        />
      </div>
      {/* Render history lives on the Production page, alongside the BOQ: every
          render made in the editor is saved here, and the team selects which to
          send to the admin / publish to the client. `activeTab` lets it refresh
          when you switch into Production, so renders/videos made after it first
          loaded (e.g. a video rendered after the photo) still appear.
          `getBoqPdf` pulls the BOQ PDF from the BoqTable above so "Send to admin"
          can attach it. */}
      <div>
        <RenderHistory
          projectId={projectId}
          activeTab={activeTab}
          getBoqPdf={() =>
            boqPdfGetter.current ? boqPdfGetter.current() : Promise.resolve(null)
          }
        />
      </div>
    </div>
  );
};

export default ProductionMenu;
