import lShape_room_json from "../../rooms/Lshape.json";
import tShape_room_json from "../../rooms/tshape.json";
import rShape_room_json from "../../rooms/Rectangle.json";

const templateList = [
  {
    id: 1,
    title: "T Shaped Room",
    size: "21’ x 21’ foot",
    url: tShape_room_json,
    coverImageUrl: require("../../../public/assets/icons/Tshape.svg"),
  },
  {
    id: 2,
    title: "Rectangle Shaped Room",
    size: "15’ x 20’ foot",
    url: rShape_room_json,
    coverImageUrl: require("../../../public/assets/icons/Standardshape.svg"),
  },
  {
    id: 3,
    title: "L Shaped Room",
    size: "20’ x 20’ foot",
    url: lShape_room_json,
    coverImageUrl: require("../../../public/assets/icons/Lshape.svg"),
  },
];

export default templateList;
