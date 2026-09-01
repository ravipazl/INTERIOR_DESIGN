import BlueprintInterface from "./blueprint-interface";

// Define a function called handleDrawFreeShape
function handleDrawFreeShape() {
  // Call a method on the BlueprintInterface object called blueprint3d
  // and set the viewer2DMode to Draw
  BlueprintInterface.blueprint3d.setViewer2DModeToDraw();
}

function handleResetCanvas() {
  BlueprintInterface.blueprint3d.model.reset();
  BlueprintInterface.setLocalStorage();
}

function handleSaveBlueprint2DDesign() {
  let data = BlueprintInterface.blueprint3d.model.exportSerialized();
  let a = window.document.createElement("a");
  let blob = new Blob([data], { type: "text" });
  a.href = window.URL.createObjectURL(blob);
  a.download = "design.cutlist";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function handleImport2DDesign() {
  let input = document.createElement("input");
  input.type = "file";
  input.accept = "application/cutlist, text/cutlist, application/json";
  input.onchange = () => {
    // you can use this method to get file and perform respective operations
    let fileName = input.files[0].name;
    var ext = fileName.substring(fileName.lastIndexOf(".") + 1).toLowerCase();
    console.log(ext);
    if (input.files && input.files[0] && (ext == "json" || ext == "cutlist")) {
      var reader = new FileReader();
      reader.onload = function (e) {
        let data = e.target.result;
        BlueprintInterface.handleTemplateUpdate(data);
      };
      reader.readAsText(input.files[0]);
    }
  };
  input.click();
}

export {
  handleDrawFreeShape,
  handleResetCanvas,
  handleSaveBlueprint2DDesign,
  handleImport2DDesign,
};
