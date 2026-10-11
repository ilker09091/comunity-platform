import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const rootPath = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(rootPath, ".editor-tests-"));
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/profile/edit", pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const user = { id: "me", username: "user_name", displayName: "Me", bio: "Keep this biography", location: "Tbilisi", website: null, avatarUrl: null, coverUrl: null, isPrivate: false };
globalThis.editorFixture = { user, calls: [], cache: null, route: null, failCover: true };
const host = document.getElementById("root"), root = createRoot(host);
try {
  await writeFile(join(temp, "shims.mjs"), `
    import React, {useState} from "react";
    const fixture = globalThis.editorFixture;
    export class ApiError extends Error {}
    export async function api(operation,{body}={}) { fixture.calls.push({operation,body}); fixture.user={...fixture.user,...body}; return fixture.user; }
    export async function upload(file,progress,operation) { fixture.calls.push({operation,file:file.name}); progress(100); if(operation==="usersSetCover" && fixture.failCover) throw new Error("Cover upload interrupted"); fixture.user={...fixture.user,[operation==="usersSetAvatar"?"avatarUrl":"coverUrl"]:"https://example.invalid/"+operation+".jpg"}; return fixture.user; }
    export const useRouter = () => ({push(route){fixture.route=route;}});
    const client = {setQueryData(key,data){fixture.cache=data;},invalidateQueries(){return Promise.resolve();}};
    export const useQueryClient = () => client;
    export const useQuery = () => ({data:fixture.user,isPending:false,isError:false});
    export const useSession = () => ({user:fixture.user,loading:false});
    export const useToast = () => () => {};
    export function useMutation(options) { const [state,setState]=useState({isPending:false,isError:false,error:null}); return {...state,mutate(){setState({isPending:true,isError:false,error:null}); options.mutationFn().then(data=>{setState({isPending:false,isError:false,error:null}); options.onSuccess?.(data);}).catch(error=>{setState({isPending:false,isError:true,error}); options.onError?.(error);});}}; }
    export const Link = ({children,href,...props}) => React.createElement("a",{...props,href},children);
    export const Avatar = ({user}) => React.createElement("span",{"data-photo":user?.avatarUrl},"Avatar");
    export const PageHeader = ({title,action}) => React.createElement("header",null,title,action);
    export const ErrorState = () => null;
    export const AppHeader = () => null;
    export const MobileNav = () => null;
    export const ImageCropDialog = ({kind,onApply,onClose}) => React.createElement("div",{"data-crop":kind},React.createElement("button",{type:"button",onClick:()=>onApply(new File(["cropped-output"],kind+"-cropped.jpg",{type:"image/jpeg"}))},"Apply fixture crop"),React.createElement("button",{type:"button",onClick:onClose},"Cancel crop"));
    export const ConfirmDialog = ({onClose,onConfirm}) => React.createElement("div",{"data-discard":true},React.createElement("button",{type:"button",onClick:onClose},"Keep editing"),React.createElement("button",{type:"button",onClick:onConfirm},"Discard"));
  `);
  for (const name of ["lib/profile-editor", "components/edit-profile"]) {
    let source = await readFile(join(rootPath, "src", name + (name.startsWith("lib") ? ".ts" : ".tsx")), "utf8");
    source = source.replace('import Link from "next/link";', 'import { Link } from "./shims.mjs";').replace('import ImageCropDialog from "./image-crop-dialog";', 'import { ImageCropDialog } from "./shims.mjs";');
    for (const dependency of ["next/navigation", "@tanstack/react-query", "@/lib/api/client", "./providers", "./ui", "./main-layout"]) source = source.replace(`from "${dependency}"`, 'from "./shims.mjs"');
    source = source.replace('from "@/lib/profile-editor"', 'from "./profile-editor.mjs"');
    await writeFile(join(temp, name.split("/")[1] + ".mjs"), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  }
  const { default: Editor } = await import(pathToFileURL(join(temp, "edit-profile.mjs")));
  await act(async () => root.render(React.createElement(Editor, {user})));
  const button = (text) => [...host.querySelectorAll("button")].find(el => el.textContent === text);
  const edit = async (label, value) => {
    const field = [...host.querySelectorAll("label.form-field")].find(el => el.textContent.startsWith(label)).querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
    await act(async () => { setter.call(field,value); field.dispatchEvent(new window.Event("input",{bubbles:true})); });
    assert.equal(field.value,value);
  };
  await edit("Display name", "New Me"); await edit("Username", "new_name");
  assert.match(host.textContent,/unsaved changes/);
  await act(async () => button("Cancel").click());
  assert.ok(host.querySelector("[data-discard]"));
  await act(async () => button("Keep editing").click());
  assert.equal(globalThis.editorFixture.calls.length,0);
  console.log("PASS unsaved edits prompt before leaving, and keeping edits performs no writes");
  for (const kind of ["avatar","cover"]) {
    const input = host.querySelector(kind === "avatar" ? ".edit-avatar input" : ".edit-cover input");
    Object.defineProperty(input,"files",{configurable:true,value:[new File(["original"],kind+".png",{type:"image/png"})]});
    await act(async () => input.dispatchEvent(new window.Event("change",{bubbles:true})));
    assert.equal(host.querySelector("[data-crop]").getAttribute("data-crop"),kind);
    assert.equal(globalThis.editorFixture.calls.length,0);
    await act(async () => button("Apply fixture crop").click());
    assert.equal(globalThis.editorFixture.calls.length,0);
  }
  console.log("PASS image selection requires crop confirmation and Apply only stages the cropped file");
  await act(async () => button("Save changes").click());
  assert.match(host.textContent,/Cover upload interrupted/);
  assert.ok(globalThis.editorFixture.cache.avatarUrl);
  assert.equal(globalThis.editorFixture.route,null);
  assert.equal(globalThis.editorFixture.calls.filter(c=>c.operation==="usersSetAvatar").length,1);
  globalThis.editorFixture.failCover=false;
  await act(async () => button("Save changes").click());
  assert.equal(globalThis.editorFixture.calls.filter(c=>c.operation==="usersSetAvatar").length,1,"successful avatar stage must not repeat");
  const patch = globalThis.editorFixture.calls.find(c=>c.operation==="usersUpdateMe").body;
  assert.deepEqual(patch,{displayName:"New Me",username:"new_name"});
  assert.equal(globalThis.editorFixture.cache.bio,user.bio);
  assert.equal(globalThis.editorFixture.route,"/profile/new_name");
  assert.ok(globalThis.editorFixture.calls.filter(c=>c.file).every(c=>c.file.endsWith("-cropped.jpg")));
  console.log("PASS partial upload failure reconciles successful stages; retry only saves remaining changes and updates caches/renamed profile route");
  await act(async () => root.unmount());
  console.log("\n3 profile editor DOM checks passed. Upload/API/crop UI were fixtures; actual image dragging and account writes were not tested.");
} finally {
  dom.window.close();
  assert.ok(resolve(temp).startsWith(resolve(rootPath)+sep) && temp.includes(".editor-tests-"));
  await rm(temp,{recursive:true,force:true});
}
