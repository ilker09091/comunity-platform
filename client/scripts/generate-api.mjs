import fs from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";

const input = new URL("../../docs/api/openapi.json", import.meta.url);
const spec = JSON.parse(await fs.readFile(input, "utf8"));
const target = new URL("../src/lib/api/", import.meta.url);
await fs.mkdir(target, { recursive: true });
await fs.writeFile(
  new URL("schema.d.ts", target),
  astToString(await openapiTS(spec)),
);
const registry = {};
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (operation.operationId)
      registry[operation.operationId] = {
        path,
        method: method.toUpperCase(),
        authenticated: (operation.security ?? []).some(
          (s) => Object.keys(s).length > 0,
        ),
      };
  }
}
await fs.writeFile(
  new URL("operations.ts", target),
  "// Generated from docs/api/openapi.json. Do not edit.\nexport const endpoints = " +
    JSON.stringify(registry, null, 2) +
    " as const;\n",
);
console.log(
  "Generated API types and operation registry from the shared contract.",
);
