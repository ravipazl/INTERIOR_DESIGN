import React, { useRef, useState } from "react";
import "./index.css";
import BoqTable from "../BoqTable";
import FullRoomViewModal from "../FullRoomViewModal";
import RenderHistory from "../RenderHistory";

const ProductionMenu = ({ activeTab, projectId }: any) => {
  const [showRoomView, setShowRoomView] = useState(false);
  // BoqTable fills this with its "build BOQ PDF" function; RenderHistory calls it
  // when the architect sends for approval, so the BOQ is attached to the email.
  const boqPdfGetter = useRef<(() => Promise<Blob | null>) | null>(null);

  return (
    <div className="production-container bg-white dark:bg-[#333333]">
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "8px 12px",
        }}
      >
        <button
          type="button"
          id="fullRoomViewButton"
          onClick={() => setShowRoomView(true)}
          title="Generate 2D drawings and rendered views of the whole room"
          className="flex flex-row items-center justify-center gap-1 text-[#1e88e5] border border-[#1e88e5] rounded px-3 py-1.5"
        >
          <span className="material-symbols-outlined font-extralight">
            architecture
          </span>
          <span className="font-normal text-xs self-center">
            Full Room View
          </span>
        </button>
      </div>
      <BoqTable
        projectId={projectId}
        activeTab={activeTab}
        registerPdfGetter={(fn) => {
          boqPdfGetter.current = fn;
        }}
      />
      {/* Render history lives on the Production page, alongside the BOQ: every
          render made in the editor is saved here, and the team selects which to
          send to the admin / publish to the client. `activeTab` lets it refresh
          when you switch into Production, so renders/videos made after it first
          loaded (e.g. a video rendered after the photo) still appear.
          `getBoqPdf` pulls the BOQ PDF from the BoqTable above so "Send to admin"
          can attach it. */}
      <RenderHistory
        projectId={projectId}
        activeTab={activeTab}
        getBoqPdf={() =>
          boqPdfGetter.current ? boqPdfGetter.current() : Promise.resolve(null)
        }
      />
      <FullRoomViewModal
        show={showRoomView}
        onClose={() => setShowRoomView(false)}
      />
    </div>
  );
};

export default ProductionMenu;
