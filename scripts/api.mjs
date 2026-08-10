import { localize } from "./constants.mjs";
import { ResearchTechTreeApplication } from "./app/research-app.mjs";
import { registerSystemAdapter, registeredSystemAdapters } from "./services/roll-service.mjs";

export function createResearchApi({ store, socketController, importExportService, weekService }) {
  let application = null;

  const getApplication = () => {
    if (application) return application;
    application = new ResearchTechTreeApplication({
      store,
      socketController,
      importExportService,
      weekService,
      onClosed: closed => {
        if (application === closed) application = null;
      }
    });
    return application;
  };

  const open = async () => {
    try {
      store.snapshot();
    } catch (_error) {
      ui.notifications?.warn?.(localize("Errors.StoreNotReady"));
      return false;
    }
    const app = getApplication();
    if (app.rendered) {
      app.bringToFront?.();
      return app;
    }
    await app.render({ force: true });
    return app;
  };

  const close = async () => {
    if (!application) return true;
    await application.close();
    application = null;
    return true;
  };

  const toggle = async () => {
    if (application?.rendered) return close();
    return open();
  };

  const refresh = () => {
    if (application?.rendered) application.render({ force: true });
  };

  return Object.freeze({
    open,
    close,
    toggle,
    registerSystemAdapter,
    registeredSystemAdapters,
    exportData: () => importExportService.exportAll(),
    exportTree: entityId => importExportService.exportTree(entityId),
    refresh
  });
}
