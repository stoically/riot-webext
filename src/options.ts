// Copyright 2020 stoically@protonmail.com
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// TODO: replace with `import type` once typescript 3.8 lands
import JSONEditor, { JSONEditorOptions } from "jsoneditor";

declare global {
  interface Window {
    JSONEditor: typeof JSONEditor;
  }
}

const setConfigEditor = async (editor: JSONEditor): Promise<void> => {
  const config = await browser.runtime.sendMessage({ type: "config" });
  editor.set(config);
};

(async (): Promise<void> => {
  if (typeof browser === "undefined") {
    // move into options.html and use some sort of templating
    await new Promise(resolve => {
      const script = document.createElement("script");
      script.src = "/browser-polyfill.min.js";
      script.async = true;
      script.onload = resolve;
      document.body.append(script);
    });
  }

  const container = document.getElementById("jsoneditor");
  if (!container) {
    return;
  }
  const options: JSONEditorOptions = {
    mode: "code",
    modes: ["code", "form", "text", "tree", "view"],
  };
  const editor = new window.JSONEditor(container, options);
  await setConfigEditor(editor);

  const message = document.getElementById("message");
  const saveConfig = document.getElementById("saveConfig");
  const resetConfig = document.getElementById("resetConfig");
  if (!message || !saveConfig || !resetConfig) {
    return;
  }

  saveConfig.addEventListener("click", async () => {
    try {
      const updatedJson = editor.get();
      await browser.storage.local.set({
        riotConfigDefault: updatedJson,
      });
      message.innerText = "Saved successfully";
    } catch (error) {
      message.innerText = `Saving failed: ${error.toString()}`;
      throw error;
    }
  });

  resetConfig.addEventListener("click", async () => {
    try {
      if (!window.confirm("Reset to default?")) {
        return;
      }
      await browser.storage.local.remove("riotConfigDefault");
      await setConfigEditor(editor);
      message.innerText = "Successfully reset to default";
    } catch (error) {
      message.innerText = `Resetting failed: ${error.toString()}`;
      throw error;
    }
  });
})();
