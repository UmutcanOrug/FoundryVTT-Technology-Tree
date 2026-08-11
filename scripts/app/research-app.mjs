import {
  LIMITS,
  MODULE_ID,
  ROLL_MODES,
  localize,
  reportError
} from "../constants.mjs";
import { ACTIONS } from "../services/action-service.mjs";
import { buildResearchContext } from "./context.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ResearchTechTreeApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "research-tech-tree-app",
    classes: ["rtt-window"],
    tag: "section",
    window: {
      title: "RTT.App.Title",
      icon: "fa-solid fa-microscope",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 1280,
      height: 820
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/research-app.hbs`
    }
  };

  constructor({ store, socketController, importExportService, weekService, onClosed, ...options }) {
    const viewportWidth = globalThis.innerWidth || 1440;
    const viewportHeight = globalThis.innerHeight || 900;
    super({
      ...options,
      position: {
        width: Math.min(viewportWidth, Math.max(760, Math.floor(viewportWidth * 0.92))),
        height: Math.min(viewportHeight, Math.max(560, Math.floor(viewportHeight * 0.88))),
        ...(options.position ?? {})
      }
    });
    this.store = store;
    this.socketController = socketController;
    this.importExportService = importExportService;
    this.weekService = weekService;
    this.onClosed = onClosed;
    const client = store.clientState;
    this.uiState = {
      selectedEntityId: client.selectedEntityId,
      activeTabByEntity: { ...client.activeTabByEntity },
      viewByTree: { ...client.viewByTree },
      selectedTechnologyId: "",
      highlightedTechnologyId: "",
      searchQuery: "",
      editMode: false,
      editor: null,
      fullscreen: false
    };
    this.unsubscribeStore = store.subscribe(() => this.#scheduleRender());
    this.listenerController = null;
    this.renderTimer = null;
    this.persistTimer = null;
    this.highlightTimer = null;
    this.savedPosition = null;
    this.actionBusy = false;
    this.categoryTabScrollByEntity = new Map();
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, await buildResearchContext({
      store: this.store,
      uiState: this.uiState,
      weekService: this.weekService
    }));
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.listenerController?.abort();
    this.listenerController = new AbortController();
    this.#activateListeners(this.element, this.listenerController.signal);
    this.#restoreCategoryTabScroll(this.element);
    this.element.classList.toggle("rtt-is-fullscreen", this.uiState.fullscreen);
  }

  async close(options = {}) {
    this.listenerController?.abort();
    clearTimeout(this.renderTimer);
    clearTimeout(this.persistTimer);
    clearTimeout(this.highlightTimer);
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.onClosed?.(this);
    return super.close(options);
  }

  #activateListeners(root, signal) {
    root.addEventListener("click", event => { void this.#onClick(event); }, { signal });
    root.addEventListener("submit", event => { void this.#onSubmit(event); }, { signal });
    root.addEventListener("input", event => this.#onInput(event), { signal });
    root.addEventListener("change", event => { void this.#onChange(event); }, { signal });
    root.addEventListener("contextmenu", event => this.#onContextMenu(event), { signal });
    root.addEventListener("dblclick", event => this.#onDoubleClick(event), { signal });
    root.addEventListener("keydown", event => this.#onKeyDown(event), { signal, capture: true });

    const viewport = root.querySelector("[data-tree-viewport]");
    if (viewport) this.#activateViewport(viewport, root, signal);
    for (const node of root.querySelectorAll("[data-tech-node]")) this.#activateNodeDrag(node, root, signal);

    const categoryTabs = root.querySelector("[data-rtt-category-tabs]");
    if (categoryTabs) {
      categoryTabs.addEventListener("scroll", () => {
        const entityId = categoryTabs.dataset.entityId;
        if (entityId) this.categoryTabScrollByEntity.set(entityId, categoryTabs.scrollLeft);
      }, { signal, passive: true });
    }
  }

  #restoreCategoryTabScroll(root) {
    const categoryTabs = root.querySelector("[data-rtt-category-tabs]");
    const entityId = categoryTabs?.dataset.entityId;
    if (!categoryTabs || !entityId) return;
    const rememberedScrollLeft = this.categoryTabScrollByEntity.get(entityId);
    if (Number.isFinite(rememberedScrollLeft)) categoryTabs.scrollLeft = rememberedScrollLeft;
  }

  async #onClick(event) {
    const target = event.target.closest("[data-rtt-ui], [data-rtt-action]");
    if (!target || !this.element.contains(target)) return;
    event.preventDefault();
    if (target.disabled || this.actionBusy) return;

    const uiAction = target.dataset.rttUi;
    if (uiAction) {
      await this.#handleUiAction(uiAction, target);
      return;
    }

    const action = target.dataset.rttAction;
    if (!action) return;
    if (target.dataset.confirmKey && !(await confirmAction(target.dataset.confirmKey))) return;
    const payload = dataPayload(target.dataset);
    await this.#executeAction(action, payload);
  }

  async #handleUiAction(action, target) {
    switch (action) {
      case "select-entity":
        this.uiState.selectedEntityId = target.dataset.entityId || "";
        this.uiState.selectedTechnologyId = "";
        this.uiState.editor = null;
        await this.#persistClientState();
        this.render({ force: true });
        break;
      case "select-tab":
        if (!this.uiState.selectedEntityId) return;
        this.uiState.activeTabByEntity[this.uiState.selectedEntityId] = target.dataset.tabId || "overview";
        this.uiState.selectedTechnologyId = "";
        await this.#persistClientState();
        this.render({ force: true });
        break;
      case "select-tech":
        if (target.closest("[data-tech-node]")?.dataset.dragged === "true") {
          target.closest("[data-tech-node]").dataset.dragged = "false";
          return;
        }
        this.uiState.selectedTechnologyId = target.dataset.technologyId || target.closest("[data-tech-node]")?.dataset.technologyId || "";
        if (target.dataset.highlightTechnology === "true") {
          this.#startTechnologyHighlight(this.uiState.selectedTechnologyId);
        }
        if (target.dataset.categoryId && this.uiState.selectedEntityId) {
          this.uiState.activeTabByEntity[this.uiState.selectedEntityId] = target.dataset.categoryId;
          await this.#persistClientState();
        }
        await this.render({ force: true });
        if (target.dataset.highlightTechnology === "true") this.#focusTechnology(this.uiState.selectedTechnologyId);
        break;
      case "toggle-edit":
        if (!game.user.isGM) return;
        this.uiState.editMode = !this.uiState.editMode;
        this.uiState.editor = null;
        this.render({ force: true });
        break;
      case "open-editor":
        if (!game.user.isGM && target.dataset.editorType !== "manualRoll") return;
        this.uiState.editor = {
          type: target.dataset.editorType,
          id: target.dataset.editorId || "",
          entityType: target.dataset.entityType,
          modifierKind: target.dataset.modifierKind,
          projectId: target.dataset.projectId,
          engineerSlot: target.dataset.engineerSlot,
          actorUuid: target.dataset.actorUuid
        };
        this.render({ force: true });
        break;
      case "close-editor":
        this.uiState.editor = null;
        this.render({ force: true });
        break;
      case "advance-week": {
        const missing = this.weekService.getMissingRolls();
        if (missing.length) {
          this.uiState.editor = { type: "advanceWeek" };
          this.render({ force: true });
        } else {
          await this.#executeAction(ACTIONS.ADVANCE_WEEK, { missingRollPolicy: "zero" });
        }
        break;
      }
      case "roll-engineer": {
        const payload = dataPayload(target.dataset);
        if (this.store.config.rollMode === ROLL_MODES.MANUAL) {
          this.uiState.editor = { type: "manualRoll", ...payload };
          this.render({ force: true });
        } else {
          await this.#executeAction(ACTIONS.ROLL_ENGINEER, payload);
        }
        break;
      }
      case "export-tree":
        try {
          const exported = this.importExportService.exportTree(this.uiState.selectedEntityId);
          ui.notifications?.info?.(localize("Notifications.TreeExportComplete", exported));
        } catch (error) {
          this.#notifyError(error);
        }
        break;
      case "export-all":
        try {
          const filename = this.importExportService.exportAll({ backup: true });
          ui.notifications?.info?.(localize("Notifications.ExportComplete", { filename }));
        } catch (error) {
          this.#notifyError(error);
        }
        break;
      case "import-trigger":
        this.element.querySelector("[data-import-input]")?.click();
        break;
      case "restore-trigger":
        this.element.querySelector("[data-restore-input]")?.click();
        break;
      case "file-picker":
        this.#openFilePicker(target);
        break;
      case "zoom-in":
        this.#changeZoom(1.15);
        break;
      case "zoom-out":
        this.#changeZoom(1 / 1.15);
        break;
      case "fit-view":
        this.#fitToView();
        break;
      case "fullscreen":
        this.#toggleFullscreen();
        break;
      case "delete-category":
        this.uiState.editor = { type: "deleteCategory", id: target.dataset.categoryId };
        this.render({ force: true });
        break;
      default:
        break;
    }
  }

  async #onSubmit(event) {
    const form = event.target.closest("[data-rtt-form]");
    if (!form) return;
    event.preventDefault();
    if (this.actionBusy) return;
    const action = form.dataset.rttForm;
    const payload = formPayload(form);
    if (event.submitter?.name) payload[event.submitter.name] = event.submitter.value;
    if (event.submitter?.dataset.confirmKey && !(await confirmAction(event.submitter.dataset.confirmKey))) return;
    const result = await this.#executeAction(action, payload);
    if (result === false) return;
    if (result?.entityId) this.uiState.selectedEntityId = result.entityId;
    if (result?.categoryId && this.uiState.selectedEntityId) this.uiState.activeTabByEntity[this.uiState.selectedEntityId] = result.categoryId;
    if (result?.technologyId) this.uiState.selectedTechnologyId = result.technologyId;
    if (form.closest("[data-editor-modal]")) this.uiState.editor = null;
    await this.#persistClientState();
    this.render({ force: true });
  }

  #onInput(event) {
    if (!event.target.matches("[data-entity-search]")) return;
    const query = event.target.value.trim().toLocaleLowerCase(game.i18n?.lang ?? "en");
    this.uiState.searchQuery = event.target.value;
    for (const row of this.element.querySelectorAll("[data-entity-row]")) {
      row.hidden = query && !String(row.dataset.searchText ?? "").includes(query);
    }
  }

  async #onChange(event) {
    if (event.target.matches("[data-research-skill-select]")) {
      const selected = event.target.selectedOptions?.[0];
      const hidden = event.target.form?.querySelector("[name='researchSkillName']");
      if (hidden) hidden.value = selected?.dataset.skillName || selected?.textContent?.trim() || "";
      return;
    }
    const isTreeImport = event.target.matches("[data-import-input]");
    const isFullRestore = event.target.matches("[data-restore-input]");
    if (!isTreeImport && !isFullRestore) return;
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const text = await this.importExportService.readFile(file);
      const imported = isTreeImport
        ? await this.importExportService.importTreeText(text)
        : await this.importExportService.replaceAllText(text);
      if (imported) {
        this.uiState.editor = null;
        this.uiState.selectedTechnologyId = "";
        if (isTreeImport && imported.entityId) {
          this.uiState.selectedEntityId = imported.entityId;
          this.uiState.activeTabByEntity[imported.entityId] = "overview";
          await this.#persistClientState();
        }
        this.render({ force: true });
      }
    } catch (error) {
      this.#notifyError(error);
    }
  }

  #onContextMenu(event) {
    const node = event.target.closest("[data-tech-node]");
    if (!node || !game.user.isGM || !this.uiState.editMode) return;
    event.preventDefault();
    this.uiState.editor = { type: "technology", id: node.dataset.technologyId };
    this.render({ force: true });
  }

  #onDoubleClick(event) {
    const node = event.target.closest("[data-tech-node]");
    if (!node) return;
    this.uiState.selectedTechnologyId = node.dataset.technologyId;
    this.render({ force: true });
  }

  #onKeyDown(event) {
    if (event.key === "Escape" && this.uiState.editor) {
      event.preventDefault();
      event.stopPropagation();
      this.uiState.editor = null;
      this.render({ force: true });
      return;
    }
    if (!["Enter", " "].includes(event.key) || !event.target.matches?.("[data-tech-node]")) return;
    event.preventDefault();
    this.uiState.selectedTechnologyId = event.target.dataset.technologyId || "";
    this.render({ force: true });
  }

  async #executeAction(action, payload) {
    this.actionBusy = true;
    this.element.classList.add("rtt-is-busy");
    const disabledStates = [...this.element.querySelectorAll("button, input[type='submit']")]
      .map(control => [control, control.disabled]);
    disabledStates.forEach(([control]) => { control.disabled = true; });
    try {
      const result = await this.socketController.execute(action, payload);
      if (result !== false) ui.notifications?.info?.(localize("Notifications.Saved"));
      return result;
    } catch (error) {
      this.#notifyError(error);
      return false;
    } finally {
      this.actionBusy = false;
      this.element.classList.remove("rtt-is-busy");
      disabledStates.forEach(([control, disabled]) => { control.disabled = disabled; });
    }
  }

  #activateViewport(viewport, root, signal) {
    viewport.addEventListener("wheel", event => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      this.#zoomAround(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top);
    }, { signal, passive: false });

    let pan = null;
    viewport.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("[data-tech-node], button, input, select, textarea")) return;
      const view = this.#currentView();
      pan = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: view.panX, panY: view.panY };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("is-panning");
    }, { signal });
    viewport.addEventListener("pointermove", event => {
      if (!pan || event.pointerId !== pan.pointerId) return;
      const view = this.#currentView();
      view.panX = pan.panX + event.clientX - pan.startX;
      view.panY = pan.panY + event.clientY - pan.startY;
      this.#applyTreeTransform(root);
    }, { signal });
    const finish = event => {
      if (!pan || event.pointerId !== pan.pointerId) return;
      pan = null;
      viewport.classList.remove("is-panning");
      this.#queueViewPersistence();
    };
    viewport.addEventListener("pointerup", finish, { signal });
    viewport.addEventListener("pointercancel", finish, { signal });
  }

  #activateNodeDrag(node, root, signal) {
    if (!game.user.isGM || !this.uiState.editMode) return;
    let drag = null;
    node.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest(".rtt-node-control")) return;
      event.stopPropagation();
      const view = this.#currentView();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: Number(node.dataset.x) || 0,
        y: Number(node.dataset.y) || 0,
        moved: false
      };
      node.setPointerCapture(event.pointerId);
      node.classList.add("is-dragging");
      node.style.zIndex = "20";
      node.dataset.dragged = "false";
      drag.zoom = view.zoom;
    }, { signal });
    node.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const deltaX = (event.clientX - drag.startX) / drag.zoom;
      const deltaY = (event.clientY - drag.startY) / drag.zoom;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 3) drag.moved = true;
      const x = Math.round(drag.x + deltaX);
      const y = Math.round(drag.y + deltaY);
      node.dataset.x = String(x);
      node.dataset.y = String(y);
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      this.#updateNodeConnections(node.dataset.technologyId, root);
    }, { signal });
    const finish = async (event, cancelled = false) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const completedDrag = drag;
      node.classList.remove("is-dragging");
      node.style.zIndex = "";
      node.dataset.dragged = String(!cancelled && completedDrag.moved);
      const moved = completedDrag.moved;
      drag = null;
      if (cancelled) {
        node.dataset.x = String(completedDrag.x);
        node.dataset.y = String(completedDrag.y);
        node.style.left = `${completedDrag.x}px`;
        node.style.top = `${completedDrag.y}px`;
        this.#updateNodeConnections(node.dataset.technologyId, root);
        return;
      }
      if (!moved) return;
      await this.#executeAction(ACTIONS.UPDATE_TECHNOLOGY_POSITION, {
        technologyId: node.dataset.technologyId,
        x: Number(node.dataset.x),
        y: Number(node.dataset.y)
      });
    };
    node.addEventListener("pointerup", event => { void finish(event); }, { signal });
    node.addEventListener("pointercancel", event => { void finish(event, true); }, { signal });
  }

  #updateNodeConnections(technologyId, root) {
    for (const line of root.querySelectorAll(`[data-connection][data-from="${cssEscape(technologyId)}"], [data-connection][data-to="${cssEscape(technologyId)}"]`)) {
      const from = root.querySelector(`[data-tech-node][data-technology-id="${cssEscape(line.dataset.from)}"]`);
      const to = root.querySelector(`[data-tech-node][data-technology-id="${cssEscape(line.dataset.to)}"]`);
      if (!to) continue;
      if (line.dataset.external === "true") {
        line.setAttribute("x1", String(Math.max(0, Number(to.dataset.x) - 54)));
        line.setAttribute("y1", String(Number(to.dataset.y) + LIMITS.NODE_HEIGHT / 2 + (Number(line.dataset.externalOffset) || 0)));
      } else {
        if (!from) continue;
        line.setAttribute("x1", String(Number(from.dataset.x) + LIMITS.NODE_WIDTH / 2));
        line.setAttribute("y1", String(Number(from.dataset.y) + LIMITS.NODE_HEIGHT / 2));
      }
      line.setAttribute("x2", String(Number(to.dataset.x) + LIMITS.NODE_WIDTH / 2));
      line.setAttribute("y2", String(Number(to.dataset.y) + LIMITS.NODE_HEIGHT / 2));
    }
  }

  #changeZoom(factor) {
    const viewport = this.element.querySelector("[data-tree-viewport]");
    if (!viewport) return;
    this.#zoomAround(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
  }

  #zoomAround(factor, screenX, screenY) {
    const view = this.#currentView();
    const previous = view.zoom;
    const next = Math.min(LIMITS.MAX_ZOOM, Math.max(LIMITS.MIN_ZOOM, previous * factor));
    if (next === previous) return;
    view.panX = screenX - ((screenX - view.panX) * next / previous);
    view.panY = screenY - ((screenY - view.panY) * next / previous);
    view.zoom = next;
    this.#applyTreeTransform(this.element);
    this.#queueViewPersistence();
  }

  #fitToView() {
    const viewport = this.element.querySelector("[data-tree-viewport]");
    const nodes = [...this.element.querySelectorAll("[data-tech-node]")];
    if (!viewport || !nodes.length) return;
    const minX = Math.min(...nodes.map(node => Number(node.dataset.x) || 0));
    const minY = Math.min(...nodes.map(node => Number(node.dataset.y) || 0));
    const maxX = Math.max(...nodes.map(node => (Number(node.dataset.x) || 0) + LIMITS.NODE_WIDTH));
    const maxY = Math.max(...nodes.map(node => (Number(node.dataset.y) || 0) + LIMITS.NODE_HEIGHT));
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const zoom = Math.min(LIMITS.MAX_ZOOM, Math.max(LIMITS.MIN_ZOOM,
      Math.min((viewport.clientWidth - 80) / contentWidth, (viewport.clientHeight - 80) / contentHeight)));
    const view = this.#currentView();
    view.zoom = zoom;
    view.panX = (viewport.clientWidth - contentWidth * zoom) / 2 - minX * zoom;
    view.panY = (viewport.clientHeight - contentHeight * zoom) / 2 - minY * zoom;
    this.#applyTreeTransform(this.element);
    this.#queueViewPersistence();
  }

  #focusTechnology(technologyId) {
    const viewport = this.element.querySelector("[data-tree-viewport]");
    const node = this.element.querySelector(`[data-tech-node][data-technology-id="${cssEscape(technologyId)}"]`);
    if (!viewport || !node) return;
    const x = Number(node.dataset.x);
    const y = Number(node.dataset.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const view = this.#currentView();
    view.panX = viewport.clientWidth / 2 - (x + LIMITS.NODE_WIDTH / 2) * view.zoom;
    view.panY = viewport.clientHeight / 2 - (y + LIMITS.NODE_HEIGHT / 2) * view.zoom;
    this.#applyTreeTransform(this.element);
    this.#queueViewPersistence();
  }

  #startTechnologyHighlight(technologyId) {
    clearTimeout(this.highlightTimer);
    this.uiState.highlightedTechnologyId = technologyId;
    this.highlightTimer = setTimeout(() => {
      if (this.uiState.highlightedTechnologyId !== technologyId) return;
      this.uiState.highlightedTechnologyId = "";
      this.highlightTimer = null;
      if (this.rendered) this.render({ force: true });
    }, 7000);
  }

  #currentView() {
    const entityId = this.uiState.selectedEntityId;
    const categoryId = this.uiState.activeTabByEntity[entityId];
    const key = `${entityId}:${categoryId}`;
    const existing = this.uiState.viewByTree[key] ?? {};
    const view = this.uiState.viewByTree[key] = {
      zoom: Math.min(LIMITS.MAX_ZOOM, Math.max(LIMITS.MIN_ZOOM, Number(existing.zoom) || 1)),
      panX: Number.isFinite(Number(existing.panX)) ? Number(existing.panX) : 24,
      panY: Number.isFinite(Number(existing.panY)) ? Number(existing.panY) : 24
    };
    return view;
  }

  #applyTreeTransform(root) {
    const view = this.#currentView();
    const world = root.querySelector("[data-tree-world]");
    if (world) world.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
    const output = root.querySelector("[data-zoom-output]");
    if (output) output.textContent = `${Math.round(view.zoom * 100)}%`;
  }

  #queueViewPersistence() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => { void this.#persistClientState(); }, 250);
  }

  async #persistClientState() {
    try {
      await this.store.setClientState({
        selectedEntityId: this.uiState.selectedEntityId,
        activeTabByEntity: this.uiState.activeTabByEntity,
        viewByTree: this.uiState.viewByTree
      });
    } catch (error) {
      reportError("clientState", error, { notify: false });
    }
  }

  #toggleFullscreen() {
    this.uiState.fullscreen = !this.uiState.fullscreen;
    this.element.classList.toggle("rtt-is-fullscreen", this.uiState.fullscreen);
    if (this.uiState.fullscreen) {
      this.savedPosition = { ...this.position };
      this.setPosition({ left: 0, top: 0, width: globalThis.innerWidth, height: globalThis.innerHeight });
    } else if (this.savedPosition) {
      this.setPosition(this.savedPosition);
    }
  }

  #openFilePicker(button) {
    const form = button.closest("form");
    const fieldName = button.dataset.fileTarget;
    const input = fieldName ? form?.elements?.namedItem?.(fieldName) : null;
    if (!input) return;
    const Picker = globalThis.foundry?.applications?.apps?.FilePicker?.implementation;
    if (!Picker) {
      ui.notifications?.warn?.(localize("Errors.FilePickerUnavailable"));
      return;
    }
    new Picker({
      type: "image",
      current: input.value || "",
      callback: path => {
        input.value = path;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }).render({ force: true });
  }

  #scheduleRender() {
    if (!this.rendered) return;
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.render({ force: true }), 45);
  }

  #notifyError(error) {
    console.warn(`${MODULE_ID} | Action failed`, error);
    ui.notifications?.error?.(error?.message || localize("Errors.ActionRejected"));
  }
}

function formPayload(form) {
  const formData = new FormData(form);
  const payload = {};
  for (const [key, value] of formData.entries()) {
    if (Object.hasOwn(payload, key)) payload[key] = Array.isArray(payload[key]) ? [...payload[key], value] : [payload[key], value];
    else payload[key] = value;
  }
  for (const input of form.querySelectorAll("input[type='checkbox'][data-bool][name]")) payload[input.name] = input.checked;
  return payload;
}

function dataPayload(dataset) {
  const ignored = new Set(["rttAction", "rttUi", "confirmKey", "editorType", "editorId"]);
  return Object.fromEntries(Object.entries(dataset).filter(([key]) => !ignored.has(key)));
}

async function confirmAction(key) {
  const message = localize(key);
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    return DialogV2.confirm({
      window: { title: localize("Common.Confirm") },
      content: `<p>${escapeDialog(message)}</p>`,
      yes: { label: localize("Common.Confirm"), icon: "fa-solid fa-check" },
      no: { label: localize("Common.Cancel") },
      modal: true
    });
  }
  return globalThis.confirm?.(message) ?? false;
}

function escapeDialog(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cssEscape(value) {
  return globalThis.CSS?.escape?.(String(value)) ?? String(value).replace(/[^a-zA-Z0-9_-]/gu, "\\$&");
}
