const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const Dotenv = require("dotenv-webpack");

module.exports = (env) => {
  const isProduction = env.NODE_ENV === "production";
  const dotenvFilename = ".env";

  return {
    entry: "./src/main.tsx",
    output: {
      path: path.join(__dirname, "build"), // the bundle output path
      filename: "bundle.js", // the name of the bundle
      publicPath: "/",
    },
    cache: true, // to improve the build speed.
    plugins: [
      new Dotenv({ path: dotenvFilename }),
      new HtmlWebpackPlugin({
        template: "src/index.html", // to import index.html file inside index.js
      }),
      new CopyPlugin({
        patterns: [{ from: "public", to: "./" }],
      }),
    ],
    devServer: {
      port: 3040, // merged Interior Design frontend (isolated from existing 3031/3000)
      historyApiFallback: true,
    },
    optimization: {
      minimize: true,
    },
    module: {
      rules: [
        {
          test: /\.(ts|js)x?$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              presets: [
                "@babel/preset-env",
                "@babel/preset-react",
                "@babel/preset-typescript",
              ],
            },
          },
        },
        {
          test: /\.(gif|png|jpe?g|webp)$/i, // raster images (Inspire uses .jpg)
          type: "asset/resource",
        },
        {
          test: /\.(ts|tsx)$/,
          loader: "babel-loader",
        },
        {
          test: /\.js$/,
          use: ["source-map-loader"],
          enforce: "pre",
        },
        {
          test: /\.(sa|sc)ss$/, // Sass (the Inspire app's custom.scss + bootstrap)
          use: ["style-loader", "css-loader", "postcss-loader", "sass-loader"],
        },
        {
          test: /\.css$/, // plain CSS
          use: ["style-loader", "css-loader", "postcss-loader"],
        },
        {
          test: /\.(woff(2)?|ttf|eot|svg)(\?v=\d+\.\d+\.\d+)?$/,
          type: "asset/resource",
        },
      ],
    },
    resolve: {
      extensions: [".*", ".js", ".jsx", ".ts", ".tsx", ".json"],
      alias: {
        "@pazl/entities": path.resolve(__dirname, "src/react-app/entities/"),
        "@pazl/events": path.resolve(__dirname, "src/events/"),
        "@pazl/context": path.resolve(__dirname, "src/react-app/context/"),
        "@pazl/services": path.resolve(__dirname, "src/react-app/services/"),
        "@pazl/components": path.resolve(
          __dirname,
          "src/react-app/components/"
        ),
        "@pazl/pages": path.resolve(__dirname, "src/react-app/pages/"),
        "@pazl/models": path.resolve(__dirname, "src/react-app/models/"),
        "@pazl/routes": path.resolve(__dirname, "src/react-app/routes/"),
        "@pazl/utils": path.resolve(__dirname, "src/react-app/utils/"),
        "@pazl/helpers": path.resolve(__dirname, "src/react-app/helpers/"),
        "@pazl/assets": path.resolve(__dirname, "src/react-app/assets/"),
        "@pazl/main": path.resolve(__dirname, "src/scripts"),
        "@pazl": path.resolve(__dirname, "src"),
      },
    },
  };
};
