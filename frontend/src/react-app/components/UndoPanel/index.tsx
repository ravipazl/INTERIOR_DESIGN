import React, { useEffect, useState } from "react";
import Draggable from "react-draggable";
import BlueprintInterface from "@pazl/blueprint-interface";
import "./index.css";

interface UndoPanelProps {
  onUndo: () => void;
  onSelectedUndoVersion: (undoVersion: any) => void;
  title: string;
}

function UndoPanel({ onUndo, onSelectedUndoVersion, title }: UndoPanelProps) {
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    getHistory();
  }, []);

  const getHistory = () => {
    const hist = BlueprintInterface?.ProjectManagerService?.floorPlanHistory;
    if (hist?.length) {
      let list = [];
      for (let i = hist.length - 1; i >= 0; i--) {
        list.push(hist[i]);
      }
      setHistory(list);
    }
  };

  return (
    <Draggable handle="strong">
      <div className="box absolute top-36 left-3 z-10 w-60 h-54 max-h-54 shadow-[0_4px_4px_0px_rgba(0,0,0,0.25)]">
        <div className="undo-modal-title" onClick={() => onUndo()}>
          <img src={require("../../images/back.svg")} width={18} height={18} />
          <span className="pl-1">{title}</span>
        </div>
        <div className="undo-items-container h-44 max-h-44 px-4 pb-4 pt-2 bg-[#fff]">
          {history?.map((item: any, index) => {
            let historyItem = JSON.parse(item);
            return (
              <div
                key={item.id}
                className="undo-item"
                onClick={() => onSelectedUndoVersion(historyItem)}
              >
                <div className="p-1 grid justify-items-stretch">
                  {historyItem.name}
                </div>
                {index < history.length - 1 ? (
                  <div className="divider" />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </Draggable>
  );
}

export default UndoPanel;
