import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const source = (path, encoding) => readFileSync(new URL(path, import.meta.url), encoding);
const excelScript = source("./vendor/jszip.min.js", "utf8") + "\n" + source("./excel.js", "utf8");
const excelTemplate = source("./schedule-template.xlsx").toString("base64");
mkdirSync("dist/server", { recursive: true });
writeFileSync("dist/server/index.js",
  source("./index.js", "utf8") + "\n" +
  "const excelScript = " + JSON.stringify(excelScript) + ";\n" +
  "const excelTemplate = " + JSON.stringify(excelTemplate) + ";\n");
