require("dotenv").config();
const tailwindcss = require("tailwindcss");
const autoprefixer = require("autoprefixer");

let tailwindConfigFile;

switch (process.env.REACT_APP_BRAND_PRESET) {
  case "pazl":
    tailwindConfigFile = "./tailwind.pazl.config.js";
    break;
  case "drazl":
    tailwindConfigFile = "./tailwind.drazl.config.js";
    break;
  default:
    tailwindConfigFile = "./tailwind.config.js";
    break;
}

module.exports = (env) => {
  return {
    plugins: [tailwindcss(tailwindConfigFile), autoprefixer],
  };
};
