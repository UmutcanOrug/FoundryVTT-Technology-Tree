import { MODULE_ID, localize, reportError } from "./constants.mjs";
import { createResearchApi } from "./api.mjs";
import { ActionService } from "./services/action-service.mjs";
import { ImportExportService } from "./services/import-export-service.mjs";
import { ProjectService } from "./services/project-service.mjs";
import { RollService } from "./services/roll-service.mjs";
import { WeekService } from "./services/week-service.mjs";
import { SocketController } from "./socket.mjs";
import { researchStore } from "./store/research-store.mjs";

let moduleApi;
let socketController;

Hooks.once("init", () => {
  try {
    registerHandlebarsHelpers();
    researchStore.registerSettings();
    registerKeybinding();

    const projectService = new ProjectService(researchStore);
    const rollService = new RollService(researchStore);
    const weekService = new WeekService(researchStore, rollService);
    const actionService = new ActionService({ store: researchStore, projectService, rollService, weekService });
    socketController = new SocketController(actionService, researchStore);
    const importExportService = new ImportExportService(researchStore);
    moduleApi = createResearchApi({ researchStore, store: researchStore, socketController, importExportService, weekService });

    const module = game.modules.get(MODULE_ID);
    if (module) module.api = moduleApi;
  } catch (error) {
    reportError("init", error);
  }
});

Hooks.once("ready", async () => {
  try {
    await researchStore.initialize();
    socketController?.bind();
  } catch (error) {
    reportError("ready", error);
  }
});

Hooks.on("updateActor", () => moduleApi?.refresh());
Hooks.on("createActor", () => moduleApi?.refresh());
Hooks.on("deleteActor", () => moduleApi?.refresh());
Hooks.on("userConnected", () => moduleApi?.refresh());

function registerKeybinding() {
  game.keybindings.register(MODULE_ID, "toggleResearchTree", {
    name: "RTT.Keybinding.Toggle.Name",
    hint: "RTT.Keybinding.Toggle.Hint",
    editable: [{ key: "KeyL" }],
    restricted: false,
    repeat: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    onDown: () => {
      if (isTextEntryFocused()) return false;
      void moduleApi?.toggle();
      return true;
    }
  });
}

function isTextEntryFocused() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName?.toLowerCase();
  return ["input", "textarea", "select"].includes(tag) || Boolean(active.isContentEditable || active.closest?.("[contenteditable='true']"));
}

function registerHandlebarsHelpers() {
  const helpers = {
    eq: (left, right) => left === right,
    ne: (left, right) => left !== right,
    not: value => !value,
    and: (...args) => args.slice(0, -1).every(Boolean),
    or: (...args) => args.slice(0, -1).some(Boolean)
  };
  for (const [name, helper] of Object.entries(helpers)) {
    if (!Handlebars.helpers[name]) Handlebars.registerHelper(name, helper);
  }
}
